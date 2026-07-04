-- Follow-up for production schema drift: admin_login_codes does not include created_by.

CREATE OR REPLACE FUNCTION public.set_admin_login_code(
  p_code TEXT,
  p_label TEXT DEFAULT 'Admin Code Login'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_code TEXT := COALESCE(p_code, '');
  v_label TEXT := COALESCE(NULLIF(TRIM(p_label), ''), 'Admin Code Login');
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF LENGTH(v_code) < 4 THEN
    RAISE EXCEPTION 'Admin code must be at least 4 characters';
  END IF;

  UPDATE public.admin_login_codes
  SET is_active = false,
      updated_at = NOW()
  WHERE owner_id = v_owner
    AND is_active = true;

  INSERT INTO public.admin_login_codes (
    owner_id,
    label,
    code_hash,
    is_active,
    updated_at
  )
  VALUES (
    v_owner,
    v_label,
    extensions.crypt(v_code, extensions.gen_salt('bf')),
    true,
    NOW()
  );

  RETURN jsonb_build_object('success', true, 'label', v_label);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_admin_login_code(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
