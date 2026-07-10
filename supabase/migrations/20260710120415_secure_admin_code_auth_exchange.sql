-- Exchange admin codes through a server-only RPC so successful code login can
-- establish a real Supabase Auth session without exposing privileged keys.

CREATE OR REPLACE FUNCTION public.verify_admin_code_login_edge(
  p_code TEXT,
  p_ip_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code TEXT := COALESCE(p_code, '');
  v_ip_hash TEXT := NULLIF(BTRIM(COALESCE(p_ip_hash, '')), '');
  v_recent_failures INTEGER := 0;
  v_owner UUID;
  v_code_id UUID;
  v_user_email TEXT;
  v_workspace_name TEXT;
BEGIN
  IF v_ip_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request', 'error', 'Unable to verify this request');
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_recent_failures
  FROM public.admin_login_code_attempts a
  WHERE a.ip_hash = v_ip_hash
    AND a.ok = false
    AND a.attempted_at >= NOW() - INTERVAL '15 minutes';

  IF v_recent_failures >= 8 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'rate_limited',
      'error', 'Too many attempts. Try again in 15 minutes.'
    );
  END IF;

  IF LENGTH(v_code) < 4 THEN
    INSERT INTO public.admin_login_code_attempts (ip_hash, ok)
    VALUES (v_ip_hash, false);
    RETURN jsonb_build_object('success', false, 'code', 'invalid_code', 'error', 'Invalid admin code');
  END IF;

  SELECT c.id, c.owner_id
  INTO v_code_id, v_owner
  FROM public.admin_login_codes c
  WHERE c.is_active = true
    AND c.code_hash = extensions.crypt(v_code, c.code_hash)
  ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  INSERT INTO public.admin_login_code_attempts (ip_hash, ok)
  VALUES (v_ip_hash, v_code_id IS NOT NULL);

  IF v_code_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_code', 'error', 'Invalid admin code');
  END IF;

  SELECT u.email
  INTO v_user_email
  FROM auth.users u
  WHERE u.id = v_owner;

  IF v_user_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'owner_unavailable', 'error', 'Admin account is unavailable');
  END IF;

  SELECT COALESCE(up.workspace_name, 'DatSer Workspace')
  INTO v_workspace_name
  FROM public.user_preferences up
  WHERE up.user_id = v_owner;

  RETURN jsonb_build_object(
    'success', true,
    'owner_id', v_owner,
    'owner_email', v_user_email,
    'workspace_name', COALESCE(v_workspace_name, 'DatSer Workspace')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_admin_code_login_edge(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_code_login_edge(TEXT, TEXT) TO service_role;

-- The browser must use the rate-limited Edge Function, never the raw verifier.
REVOKE ALL ON FUNCTION public.verify_admin_code_login(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_code_login(TEXT) TO service_role;

COMMENT ON FUNCTION public.verify_admin_code_login_edge(TEXT, TEXT)
IS 'Server-only, rate-limited admin-code verifier used by the admin-code-login Edge Function.';

NOTIFY pgrst, 'reload schema';
