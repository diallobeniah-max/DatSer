-- AI Provider routing + model support (additive).
--
-- Extends the AI Provider credentials introduced in
-- `20260815170000_ai_provider_credentials.sql` (already applied live) with:
--   - a per-provider model column
--   - a second provider (qwen / Alibaba Cloud) alongside gemini
--   - a simple primary/fallback routing preference for extraction
--
-- The existing SECURITY DEFINER RPCs and encrypted storage remain unchanged.
-- New operations are also SECURITY DEFINER and admin/owner gated; the browser
-- still never sees a decrypted secret. No member/attendance/provenance/ownership
-- data is touched.

-- Widen the provider check and add a model column (idempotent).
alter table public.ai_provider_credentials
  drop constraint if exists ai_provider_credentials_provider_check;
alter table public.ai_provider_credentials
  add constraint ai_provider_credentials_provider_check
  check (provider in ('gemini', 'qwen'));
alter table public.ai_provider_credentials
  add column if not exists model text not null default '';

-- Simple routing preference (one row per workspace).
create table if not exists public.ai_provider_routing (
  owner_id uuid not null references auth.users(id) on delete cascade,
  primary_provider text not null check (primary_provider in ('gemini', 'qwen')),
  fallback_provider text check (fallback_provider in ('gemini', 'qwen')),
  updated_at timestamptz not null default now(),
  primary key (owner_id)
);

alter table public.ai_provider_routing enable row level security;
revoke all on table public.ai_provider_routing from public, anon, authenticated;
drop policy if exists "ai provider routing deny all" on public.ai_provider_routing;
create policy "ai provider routing deny all" on public.ai_provider_routing
  for all using (false) with check (false);

-- Status now also returns the configured model.
create or replace function public.ai_provider_get_status(
  p_owner_id uuid,
  p_provider text default 'gemini'
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_row public.ai_provider_credentials%rowtype;
begin
  if p_provider not in ('gemini', 'qwen') then
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
      'model', '',
      'lastVerified', null,
      'status', 'not_configured'
    );
  end if;
  return jsonb_build_object(
    'provider', p_provider,
    'configured', true,
    'maskedSuffix', v_row.masked_suffix,
    'model', v_row.model,
    'lastVerified', v_row.last_verified,
    'status', 'configured'
  );
end;
$$;
revoke all on function public.ai_provider_get_status(uuid, text) from public, anon;
grant execute on function public.ai_provider_get_status(uuid, text) to authenticated;

-- Set/replace a provider secret (extended provider check + model param).
create or replace function public.ai_provider_set_secret(
  p_owner_id uuid,
  p_provider text,
  p_secret text,
  p_encryption_key text,
  p_model text default ''
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_clean text;
  v_suffix text;
  v_encrypted text;
  v_existing_key_version integer;
  v_model text;
begin
  if p_provider not in ('gemini', 'qwen') then
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
  v_model := nullif(btrim(coalesce(p_model, '')), '');

  select key_version into v_existing_key_version
  from public.ai_provider_credentials
  where owner_id = p_owner_id and provider = p_provider;

  if v_existing_key_version is null then
    insert into public.ai_provider_credentials(owner_id, provider, encrypted_secret, key_version, masked_suffix, model)
    values (p_owner_id, p_provider, v_encrypted, 1, v_suffix, v_model)
    on conflict (owner_id, provider) do update set
      encrypted_secret = excluded.encrypted_secret,
      masked_suffix = excluded.masked_suffix,
      model = excluded.model,
      last_verified = null,
      updated_at = now();
  else
    update public.ai_provider_credentials
    set encrypted_secret = v_encrypted,
        key_version = v_existing_key_version + 1,
        masked_suffix = v_suffix,
        model = coalesce(v_model, model),
        last_verified = null,
        updated_at = now()
    where owner_id = p_owner_id and provider = p_provider;
  end if;

  return jsonb_build_object(
    'provider', p_provider,
    'configured', true,
    'maskedSuffix', v_suffix,
    'model', coalesce(v_model, ''),
    'lastVerified', null,
    'status', 'configured'
  );
end;
$$;
revoke all on function public.ai_provider_set_secret(uuid, text, text, text, text) from public, anon;
grant execute on function public.ai_provider_set_secret(uuid, text, text, text, text) to authenticated;

-- Update only the model for an existing provider (no secret change).
create or replace function public.ai_provider_set_model(
  p_owner_id uuid,
  p_provider text,
  p_model text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_model text;
begin
  if p_provider not in ('gemini', 'qwen') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  v_actor := public.require_permanent_workspace_actor(p_owner_id, true);
  v_model := nullif(btrim(coalesce(p_model, '')), '');
  update public.ai_provider_credentials
  set model = coalesce(v_model, ''), updated_at = now()
  where owner_id = p_owner_id and provider = p_provider;
  return jsonb_build_object('provider', p_provider, 'model', coalesce(v_model, ''), 'status', 'configured');
end;
$$;
revoke all on function public.ai_provider_set_model(uuid, text, text) from public, anon;
grant execute on function public.ai_provider_set_model(uuid, text, text) to authenticated;

-- Read the routing preference (returns providers + which are actually configured).
create or replace function public.ai_provider_get_routing(p_owner_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_row public.ai_provider_routing%rowtype;
  v_primary text;
  v_fallback text;
begin
  v_actor := public.require_permanent_workspace_actor(p_owner_id, true);
  select * into v_row from public.ai_provider_routing where owner_id = p_owner_id;
  v_primary := coalesce(v_row.primary_provider, 'gemini');
  v_fallback := v_row.fallback_provider;
  return jsonb_build_object(
    'primaryProvider', v_primary,
    'fallbackProvider', v_fallback,
    'fallbackEnabled', v_fallback is not null
  );
end;
$$;
revoke all on function public.ai_provider_get_routing(uuid) from public, anon;
grant execute on function public.ai_provider_get_routing(uuid) to authenticated;

-- Set the routing preference. fallback null disables fallback.
create or replace function public.ai_provider_set_routing(
  p_owner_id uuid,
  p_primary text,
  p_fallback text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_fallback text;
begin
  if p_primary not in ('gemini', 'qwen') then
    raise exception 'Unsupported primary provider' using errcode = '22023';
  end if;
  v_fallback := nullif(btrim(coalesce(p_fallback, '')), '');
  if v_fallback is not null and v_fallback not in ('gemini', 'qwen') then
    raise exception 'Unsupported fallback provider' using errcode = '22023';
  end if;
  v_actor := public.require_permanent_workspace_actor(p_owner_id, true);
  insert into public.ai_provider_routing(owner_id, primary_provider, fallback_provider)
  values (p_owner_id, p_primary, v_fallback)
  on conflict (owner_id) do update set
    primary_provider = excluded.primary_provider,
    fallback_provider = excluded.fallback_provider,
    updated_at = now();
  return jsonb_build_object(
    'primaryProvider', p_primary,
    'fallbackProvider', v_fallback,
    'fallbackEnabled', v_fallback is not null
  );
end;
$$;
revoke all on function public.ai_provider_set_routing(uuid, text, text) from public, anon;
grant execute on function public.ai_provider_set_routing(uuid, text, text) to authenticated;

-- Resolve key now returns model alongside the decrypted secret (server-only).
create or replace function public.ai_provider_resolve_key(
  p_owner_id uuid,
  p_provider text,
  p_encryption_key text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_secret text;
  v_encrypted text;
  v_model text;
begin
  if p_provider not in ('gemini', 'qwen') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  -- Extraction is authorized for the workspace owner OR an accepted/active
  -- collaborator (require_admin=false), but this RPC is NOT granted to browser
  -- roles — only the Vercel serverless function calls it with a server-side
  -- (service-role) Supabase client.
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  select encrypted_secret, model into v_encrypted, v_model
  from public.ai_provider_credentials
  where owner_id = p_owner_id and provider = p_provider;
  if v_encrypted is null then
    return jsonb_build_object('key', '', 'model', v_model);
  end if;
  begin
    v_secret := pgp_sym_decrypt(v_encrypted::bytea, p_encryption_key);
  exception when others then
    return jsonb_build_object('key', '', 'model', v_model);
  end;
  return jsonb_build_object('key', v_secret, 'model', v_model);
end;
$$;
revoke all on function public.ai_provider_resolve_key(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
