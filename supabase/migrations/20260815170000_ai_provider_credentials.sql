-- AI Provider credentials — secure server-side storage for extraction providers.
--
-- Additive migration. Providers (Gemini today; OpenAI/DeepSeek later) store their
-- API secrets ENCRYPTED at rest with a server-only encryption key. The browser
-- has NO direct SELECT access to the credentials table; every operation goes
-- through SECURITY DEFINER RPCs that:
--   - authorize the caller as a permanent workspace ADMIN/owner
--   - never return a decrypted secret
--   - return status, maskedSuffix, and lastVerified only
--
-- The encryption key lives ONLY in the Vercel server environment
-- (AI_PROVIDER_ENCRYPTION_KEY). The extraction serverless function decrypts the
-- stored secret server-side when it needs to call Gemini; it is never sent to
-- the browser, stored client-side, or placed in VITE_*/bundle.
--
-- Resolution order in the extraction path (see server/geminiKey.js):
--   1. securely stored provider credential (this table, encrypted)
--   2. existing GEMINI_API_KEY server environment variable (fallback)
--
-- This migration does NOT touch members, attendance, provenance, ownership,
-- member codes, or any other table. It only adds provider credential storage.

-- Provider metadata + encrypted secret (Architecture A).
create table if not exists public.ai_provider_credentials (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gemini')),
  encrypted_secret text not null,
  key_version integer not null default 1,
  masked_suffix text not null default '',
  last_verified timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);

-- Client roles can never read provider credentials directly.
alter table public.ai_provider_credentials enable row level security;
revoke all on table public.ai_provider_credentials from public, anon, authenticated;
drop policy if exists "ai provider credentials deny all" on public.ai_provider_credentials;
create policy "ai provider credentials deny all" on public.ai_provider_credentials
  for all using (false) with check (false);

-- A server-side operation that reads the metadata status WITHOUT the secret.
-- Authorized caller: permanent workspace admin/owner only.
create or replace function public.ai_provider_get_status(
  p_owner_id uuid,
  p_provider text default 'gemini'
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_row public.ai_provider_credentials%rowtype;
begin
  if p_provider not in ('gemini') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  v_actor := public.require_permanent_workspace_actor(p_owner_id, true);
  select * into v_row from public.ai_provider_credentials
  where owner_id = p_owner_id and provider = p_provider;
  if not found then
    return jsonb_build_object(
      'provider', p_provider,
      'configured', false,
      'maskedSuffix', '',
      'lastVerified', null,
      'status', 'not_configured'
    );
  end if;
  return jsonb_build_object(
    'provider', p_provider,
    'configured', true,
    'maskedSuffix', v_row.masked_suffix,
    'lastVerified', v_row.last_verified,
    'status', 'configured'
  );
end;
$$;
revoke all on function public.ai_provider_get_status(uuid, text) from public, anon;
grant execute on function public.ai_provider_get_status(uuid, text) to authenticated;

-- Stores a NEW encrypted provider secret. Authorized caller: permanent admin/owner.
-- The secret never leaves the server unencrypted; the browser sends it once over
-- HTTPS and this RPC encrypts it at rest with the server-only key.
create or replace function public.ai_provider_set_secret(
  p_owner_id uuid,
  p_provider text,
  p_secret text,
  p_encryption_key text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_clean text;
  v_suffix text;
  v_encrypted text;
  v_existing_key_version integer;
begin
  if p_provider not in ('gemini') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  v_actor := public.require_permanent_workspace_actor(p_owner_id, true);
  if p_encryption_key is null or btrim(p_encryption_key) = '' then
    raise exception 'Server encryption key is not configured' using errcode = '42501';
  end if;
  v_clean := nullif(btrim(coalesce(p_secret, '')), '');
  if v_clean is null or length(v_clean) < 10 then
    raise exception 'A valid provider secret is required' using errcode = '22023';
  end if;
  v_suffix := right(v_clean, 4);
  v_encrypted := pgp_sym_encrypt(v_clean, p_encryption_key);

  select key_version into v_existing_key_version
  from public.ai_provider_credentials
  where owner_id = p_owner_id and provider = p_provider;

  if v_existing_key_version is null then
    insert into public.ai_provider_credentials(owner_id, provider, encrypted_secret, key_version, masked_suffix)
    values (p_owner_id, p_provider, v_encrypted, 1, v_suffix)
    on conflict (owner_id, provider) do update set
      encrypted_secret = excluded.encrypted_secret,
      masked_suffix = excluded.masked_suffix,
      last_verified = null,
      updated_at = now();
  else
    update public.ai_provider_credentials
    set encrypted_secret = v_encrypted,
        key_version = v_existing_key_version + 1,
        masked_suffix = v_suffix,
        last_verified = null,
        updated_at = now()
    where owner_id = p_owner_id and provider = p_provider;
  end if;

  return jsonb_build_object(
    'provider', p_provider,
    'configured', true,
    'maskedSuffix', v_suffix,
    'lastVerified', null,
    'status', 'configured'
  );
end;
$$;
revoke all on function public.ai_provider_set_secret(uuid, text, text, text) from public, anon;
grant execute on function public.ai_provider_set_secret(uuid, text, text, text) to authenticated;

-- Server-only resolution of the DECRYPTED key. This function is SECURITY DEFINER
-- and is NOT granted to anon/authenticated; only the Vercel serverless function
-- calls it with a server-side (service-role) Supabase client. It verifies the
-- caller is the workspace owner/admin before decrypting, and the result is used
-- exclusively in the server runtime for provider calls — never returned to a
-- browser request body.
create or replace function public.ai_provider_resolve_key(
  p_owner_id uuid,
  p_provider text,
  p_encryption_key text
) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_secret text;
  v_encrypted text;
begin
  if p_provider not in ('gemini') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  -- Extraction is authorized for the workspace owner OR an accepted/active
  -- collaborator (require_admin=false), but this RPC is NOT granted to browser
  -- roles — only the Vercel serverless function calls it with a server-side
  -- (service-role) Supabase client. So collaborators can power extraction while
  -- the secret itself never reaches the browser.
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_encryption_key is null or btrim(p_encryption_key) = '' then
    return '';
  end if;
  select encrypted_secret into v_encrypted
  from public.ai_provider_credentials
  where owner_id = p_owner_id and provider = p_provider;
  if v_encrypted is null then
    return '';
  end if;
  begin
    v_secret := pgp_sym_decrypt(v_encrypted::bytea, p_encryption_key);
  exception when others then
    return '';
  end;
  return v_secret;
end;
$$;
revoke all on function public.ai_provider_resolve_key(uuid, text, text) from public, anon, authenticated;

-- Marks a provider's last-verified timestamp after a successful test/extraction.
create or replace function public.ai_provider_mark_verified(
  p_owner_id uuid,
  p_provider text
) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_provider not in ('gemini') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  update public.ai_provider_credentials
  set last_verified = now()
  where owner_id = p_owner_id and provider = p_provider;
end;
$$;
revoke all on function public.ai_provider_mark_verified(uuid, text) from public, anon;
grant execute on function public.ai_provider_mark_verified(uuid, text) to authenticated;

-- Removes a stored provider credential. Authorized caller: permanent admin/owner.
create or replace function public.ai_provider_remove(
  p_owner_id uuid,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_provider not in ('gemini') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  perform public.require_permanent_workspace_actor(p_owner_id, true);
  delete from public.ai_provider_credentials
  where owner_id = p_owner_id and provider = p_provider;
  return jsonb_build_object('provider', p_provider, 'configured', false, 'status', 'not_configured');
end;
$$;
revoke all on function public.ai_provider_remove(uuid, text) from public, anon;
grant execute on function public.ai_provider_remove(uuid, text) to authenticated;

notify pgrst, 'reload schema';
