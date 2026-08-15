-- AI Provider credential functions — pgcrypto schema qualification patch.
--
-- Additive. The already-applied provider migrations
-- (`20260815170000_ai_provider_credentials.sql`, `20260815180000_ai_provider_routing.sql`)
-- are frozen historical sources and are NOT modified. This patch fixes a real
-- production runtime bug in the credential encrypt/decrypt functions:
--
--   pgcrypto is installed in the `extensions` schema, NOT `public`.
--   The affected SECURITY DEFINER functions use `search_path = pg_catalog, public, pg_temp`
--   and call `pgp_sym_encrypt` / `pgp_sym_decrypt` UNQUALIFIED, so they cannot be
--   resolved at runtime:
--
--     ERROR:  function pgp_sym_encrypt(text,text) does not exist
--
-- Fix: explicitly qualify as `extensions.pgp_sym_encrypt` / `extensions.pgp_sym_decrypt`.
-- The search_path is left unchanged (no broad `extensions` addition); only the
-- two provider-credential functions are replaced, each with explicit qualification.
--
-- Also drops a stale 4-argument overload of `ai_provider_set_secret` (from the
-- first migration) that still exists alongside the current 5-argument overload and
-- carried the same unqualified-encrypt bug. The 5-argument overload is the one the
-- server calls (it accepts a model); only it is redefined.
--
-- This migration changes NO table data, members, attendance, provenance, ownership,
-- or codes.

-- Drop the stale 4-arg overload (unused; superseded by the 5-arg overload).
drop function if exists public.ai_provider_set_secret(uuid, text, text, text);

-- Recreate the current 5-arg set_secret with schema-qualified encryption.
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
  -- Explicit schema qualification: pgcrypto lives in the `extensions` schema.
  v_encrypted := extensions.pgp_sym_encrypt(v_clean, p_encryption_key);
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

-- Recreate the server-side decrypt function with schema-qualified decryption.
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
    -- Explicit schema qualification: pgcrypto lives in the `extensions` schema.
    v_secret := extensions.pgp_sym_decrypt(v_encrypted::bytea, p_encryption_key);
  exception when others then
    -- A wrong/missing encryption key or corrupted ciphertext must NOT look valid.
    return jsonb_build_object('key', '', 'model', v_model);
  end;
  return jsonb_build_object('key', v_secret, 'model', v_model);
end;
$$;
revoke all on function public.ai_provider_resolve_key(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
