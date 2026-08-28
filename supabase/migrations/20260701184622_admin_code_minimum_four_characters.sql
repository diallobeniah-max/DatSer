-- Lower Admin Code Login minimum length from 6 to 4 characters.
-- Codes remain mixed-character passcodes and are stored only as bcrypt hashes.

CREATE OR REPLACE FUNCTION public.set_admin_login_code(
    p_code TEXT,
    p_label TEXT DEFAULT 'Admin Code Login'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id UUID := auth.uid();
    v_code TEXT := NULLIF(BTRIM(COALESCE(p_code, '')), '');
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF v_code IS NULL OR LENGTH(v_code) < 4 THEN
        RAISE EXCEPTION 'Admin code must be at least 4 characters';
    END IF;

    UPDATE public.admin_login_codes
    SET is_active = FALSE, updated_at = NOW()
    WHERE owner_id = v_owner_id
      AND is_active = TRUE;

    INSERT INTO public.admin_login_codes(owner_id, code_hash, label, is_active)
    VALUES (v_owner_id, crypt(v_code, gen_salt('bf')), COALESCE(NULLIF(TRIM(p_label), ''), 'Admin Code Login'), TRUE);

    RETURN jsonb_build_object(
        'ok', true,
        'message', 'Admin code updated',
        'updated_at', NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_login_code(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_admin_login_code(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_admin_login_code(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.set_admin_login_code(TEXT, TEXT)
IS 'Sets the owner Admin Code Login passcode. Minimum 4 mixed characters; stores only a bcrypt hash.';;
