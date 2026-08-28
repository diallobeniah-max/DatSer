CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    collaborator_email TEXT,
    display_name TEXT,
    collaborator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    invite_token TEXT,
    invited_by_name TEXT,
    accepted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.collaborators
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS collaborator_email TEXT,
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS collaborator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS invite_token TEXT,
    ADD COLUMN IF NOT EXISTS invited_by_name TEXT,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.collaborators
SET
    email = LOWER(COALESCE(NULLIF(TRIM(email), ''), NULLIF(TRIM(collaborator_email), ''))),
    collaborator_email = LOWER(COALESCE(NULLIF(TRIM(collaborator_email), ''), NULLIF(TRIM(email), ''))),
    role = COALESCE(NULLIF(TRIM(role), ''), CASE WHEN is_admin THEN 'admin' ELSE 'member' END),
    status = COALESCE(NULLIF(TRIM(status), ''), 'pending'),
    is_admin = COALESCE(is_admin, FALSE),
    updated_at = COALESCE(updated_at, NOW())
WHERE email IS NULL
   OR collaborator_email IS NULL
   OR role IS NULL
   OR status IS NULL
   OR updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_collaborators_owner_id ON public.collaborators(owner_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_user_id ON public.collaborators(collaborator_user_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_email ON public.collaborators(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_collaborators_owner_email ON public.collaborators(owner_id, LOWER(email));

CREATE OR REPLACE FUNCTION public.touch_collaborators_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.email = LOWER(COALESCE(NULLIF(TRIM(NEW.email), ''), NULLIF(TRIM(NEW.collaborator_email), '')));
    NEW.collaborator_email = LOWER(COALESCE(NULLIF(TRIM(NEW.collaborator_email), ''), NULLIF(TRIM(NEW.email), '')));
    NEW.role = COALESCE(NULLIF(TRIM(NEW.role), ''), CASE WHEN COALESCE(NEW.is_admin, FALSE) THEN 'admin' ELSE 'member' END);
    NEW.is_admin = COALESCE(NEW.is_admin, NEW.role = 'admin', FALSE);
    NEW.status = COALESCE(NULLIF(TRIM(NEW.status), ''), 'pending');
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_collaborators_updated_at ON public.collaborators;
CREATE TRIGGER touch_collaborators_updated_at
BEFORE INSERT OR UPDATE ON public.collaborators
FOR EACH ROW EXECUTE FUNCTION public.touch_collaborators_updated_at();

ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collaborators_owner_manage ON public.collaborators;
CREATE POLICY collaborators_owner_manage ON public.collaborators
FOR ALL
TO authenticated
USING ((SELECT auth.uid()) = owner_id)
WITH CHECK ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS collaborators_self_read ON public.collaborators;
CREATE POLICY collaborators_self_read ON public.collaborators
FOR SELECT
TO authenticated
USING (
    collaborator_user_id = (SELECT auth.uid())
    OR EXISTS (
        SELECT 1
        FROM auth.users au
        WHERE au.id = (SELECT auth.uid())
          AND public.collaborators.email = LOWER(au.email)
    )
);

DROP FUNCTION IF EXISTS public.accept_invite_for_user(TEXT);

CREATE OR REPLACE FUNCTION public.accept_invite_for_user(user_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT := LOWER(NULLIF(TRIM(user_email), ''));
    v_row public.collaborators%ROWTYPE;
    v_accepted INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('accepted', false, 'message', 'Authentication required');
    END IF;

    IF v_email IS NULL THEN
        SELECT LOWER(email) INTO v_email FROM auth.users WHERE id = v_user_id;
    END IF;

    SELECT *
    INTO v_row
    FROM public.collaborators
    WHERE LOWER(email) = v_email
      AND status IN ('pending', 'accepted', 'active')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('accepted', false, 'message', 'No pending invite found');
    END IF;

    UPDATE public.collaborators
    SET
        collaborator_user_id = v_user_id,
        status = CASE WHEN status = 'disabled' THEN status ELSE 'active' END,
        accepted_at = COALESCE(accepted_at, NOW())
    WHERE LOWER(email) = v_email
      AND status IN ('pending', 'accepted', 'active');

    GET DIAGNOSTICS v_accepted = ROW_COUNT;

    RETURN jsonb_build_object(
        'accepted', true,
        'owner_id', v_row.owner_id,
        'collaborator_id', v_row.id,
        'is_admin', COALESCE(v_row.is_admin, false),
        'accepted_count', v_accepted
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_code_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('is_set', false, 'active_count', 0, 'last_rotated_at', NULL);
    END IF;

    RETURN (
        SELECT jsonb_build_object(
        'is_set', EXISTS (
            SELECT 1
            FROM public.admin_login_codes
            WHERE owner_id = auth.uid()
              AND is_active = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
        ),
        'active_count', (
            SELECT COUNT(*)
            FROM public.admin_login_codes
            WHERE owner_id = auth.uid()
              AND is_active = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
        ),
        'last_rotated_at', (
            SELECT MAX(updated_at)
            FROM public.admin_login_codes
            WHERE owner_id = auth.uid()
        )
        )
    );
END;
$$;

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

    IF v_code IS NULL OR LENGTH(v_code) < 6 THEN
        RAISE EXCEPTION 'Admin code must be at least 6 characters';
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

CREATE OR REPLACE FUNCTION public.relink_collaborators_for_owner(p_owner_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id UUID := COALESCE(p_owner_id, auth.uid());
    v_linked INTEGER := 0;
    v_missing INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL OR v_owner_id IS NULL OR auth.uid() <> v_owner_id THEN
        RAISE EXCEPTION 'Only the workspace owner can relink collaborators';
    END IF;

    UPDATE public.collaborators c
    SET
        collaborator_user_id = au.id,
        status = CASE WHEN c.status = 'disabled' THEN c.status ELSE 'active' END,
        accepted_at = COALESCE(c.accepted_at, NOW())
    FROM auth.users au
    WHERE c.owner_id = v_owner_id
      AND c.collaborator_user_id IS NULL
      AND c.email IS NOT NULL
      AND LOWER(au.email) = LOWER(c.email);

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    SELECT COUNT(*)
    INTO v_missing
    FROM public.collaborators c
    WHERE c.owner_id = v_owner_id
      AND c.collaborator_user_id IS NULL
      AND c.status <> 'disabled';

    RETURN jsonb_build_object(
        'ok', true,
        'linked', v_linked,
        'missing_auth_user', v_missing
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite_for_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_code_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_admin_login_code(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.relink_collaborators_for_owner(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.accept_invite_for_user(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_code_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_login_code(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relink_collaborators_for_owner(UUID) TO authenticated;;
