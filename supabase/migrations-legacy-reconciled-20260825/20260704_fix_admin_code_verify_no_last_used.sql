-- Follow-up for production schema drift: admin_login_codes has no last_used_at column.

CREATE OR REPLACE FUNCTION public.verify_admin_code_login(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code TEXT := COALESCE(p_code, '');
  v_code_hash TEXT := encode(extensions.digest(v_code, 'sha256'), 'hex');
  v_owner UUID;
  v_code_id UUID;
  v_user_email TEXT;
  v_workspace_name TEXT;
BEGIN
  IF LENGTH(v_code) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin code must be at least 4 characters');
  END IF;

  SELECT c.id, c.owner_id
  INTO v_code_id, v_owner
  FROM public.admin_login_codes c
  WHERE c.is_active = true
    AND c.code_hash = extensions.crypt(v_code, c.code_hash)
  ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  INSERT INTO public.admin_login_code_attempts (
    ip_hash,
    ok
  )
  VALUES (
    v_code_hash,
    v_code_id IS NOT NULL
  );

  IF v_code_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  SELECT u.email
  INTO v_user_email
  FROM auth.users u
  WHERE u.id = v_owner;

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

GRANT EXECUTE ON FUNCTION public.verify_admin_code_login(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
