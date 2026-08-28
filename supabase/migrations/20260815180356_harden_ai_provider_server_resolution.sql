-- Make the private server-side credential resolver compatible with the
-- service-role client used by the Vercel API. Browser roles remain revoked.
-- The result exposes only a safe resolution status; it never exposes a secret
-- or a database/decryption error message.
create or replace function public.ai_provider_resolve_key(
  p_owner_id uuid,
  p_provider text,
  p_encryption_key text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_secret text;
  v_encrypted text;
  v_model text;
begin
  if p_provider not in ('gemini', 'qwen') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;

  -- This function is revoked from public/anon/authenticated. The only caller
  -- without a user JWT is DatSer's server-held service-role key. Interactive
  -- callers retain workspace authorization as a defense in depth.
  if auth.role() <> 'service_role' then
    perform public.require_permanent_workspace_actor(p_owner_id, false);
  end if;

  select encrypted_secret, model into v_encrypted, v_model
  from public.ai_provider_credentials
  where owner_id = p_owner_id and provider = p_provider;
  if v_encrypted is null then
    return jsonb_build_object('key', '', 'model', coalesce(v_model, ''), 'status', 'not_found');
  end if;
  if p_encryption_key is null or btrim(p_encryption_key) = '' then
    return jsonb_build_object('key', '', 'model', coalesce(v_model, ''), 'status', 'unreadable', 'code', 'ENCRYPTION_KEY_UNAVAILABLE');
  end if;
  begin
    v_secret := extensions.pgp_sym_decrypt(v_encrypted::bytea, p_encryption_key);
  exception when others then
    return jsonb_build_object('key', '', 'model', coalesce(v_model, ''), 'status', 'unreadable', 'code', 'CREDENTIAL_DECRYPT_FAILED');
  end;
  if v_secret is null or btrim(v_secret) = '' then
    return jsonb_build_object('key', '', 'model', coalesce(v_model, ''), 'status', 'unreadable', 'code', 'CREDENTIAL_DECRYPT_FAILED');
  end if;
  return jsonb_build_object('key', v_secret, 'model', coalesce(v_model, ''), 'status', 'resolved');
end;
$$;
revoke all on function public.ai_provider_resolve_key(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';;
