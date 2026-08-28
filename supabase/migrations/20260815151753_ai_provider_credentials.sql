-- AI Provider credentials — secure server-side storage for extraction providers.
-- Additive migration. Providers store their API secrets ENCRYPTED at rest with a
-- server-only encryption key. The browser has NO direct SELECT access; every
-- operation goes through SECURITY DEFINER RPCs that authorize a permanent
-- workspace ADMIN/owner and never return a decrypted secret.

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

alter table public.ai_provider_credentials enable row level security;
revoke all on table public.ai_provider_credentials from public, anon, authenticated;
drop policy if exists "ai provider credentials deny all" on public.ai_provider_credentials;
create policy "ai provider credentials deny all" on public.ai_provider_credentials
  for all using (false) with check (false);

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

notify pgrst, 'reload schema';;
