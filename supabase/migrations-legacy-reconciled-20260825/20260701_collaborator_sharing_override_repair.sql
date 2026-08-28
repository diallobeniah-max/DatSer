-- Repair collaborator display/loading and owner override safety after Team Sharing/Admin Management.
-- This keeps protected auth.users access inside SECURITY DEFINER RPCs and exposes only safe fields.

CREATE OR REPLACE FUNCTION public.list_workspace_collaborators(p_owner_id UUID DEFAULT auth.uid())
RETURNS TABLE (
    id UUID,
    owner_id UUID,
    email TEXT,
    collaborator_email TEXT,
    display_name TEXT,
    role TEXT,
    status TEXT,
    is_admin BOOLEAN,
    collaborator_user_id UUID,
    invite_token TEXT,
    expires_at TIMESTAMPTZ,
    invited_by_name TEXT,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    auth_account_status TEXT,
    linked_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester UUID := auth.uid();
    v_owner_id UUID := COALESCE(p_owner_id, auth.uid());
    v_allowed BOOLEAN := FALSE;
BEGIN
    IF v_requester IS NULL OR v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_allowed := v_requester = v_owner_id OR EXISTS (
        SELECT 1
        FROM public.collaborators c
        WHERE c.owner_id = v_owner_id
          AND c.collaborator_user_id = v_requester
          AND c.status IN ('active', 'accepted')
          AND COALESCE(c.is_admin, false) = true
    );

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Only the workspace owner or an admin collaborator can list collaborators';
    END IF;

    RETURN QUERY
    SELECT
        c.id,
        c.owner_id,
        LOWER(COALESCE(c.email, c.collaborator_email)) AS email,
        LOWER(COALESCE(c.collaborator_email, c.email)) AS collaborator_email,
        COALESCE(NULLIF(c.display_name, ''), LOWER(COALESCE(c.email, c.collaborator_email))) AS display_name,
        COALESCE(c.role, CASE WHEN COALESCE(c.is_admin, false) THEN 'admin' ELSE 'member' END) AS role,
        c.status,
        COALESCE(c.is_admin, false) AS is_admin,
        c.collaborator_user_id,
        c.invite_token,
        c.expires_at,
        c.invited_by_name,
        c.accepted_at,
        c.created_at,
        c.updated_at,
        CASE
            WHEN c.status = 'disabled' THEN 'disabled'
            WHEN au.id IS NULL THEN 'missing_auth_account'
            WHEN au.email_confirmed_at IS NULL THEN 'needs_email_confirmation'
            ELSE 'ready'
        END AS auth_account_status,
        CASE
            WHEN c.status = 'disabled' THEN 'disabled'
            WHEN c.collaborator_user_id IS NULL THEN 'needs_link'
            WHEN au.id IS NULL THEN 'missing_auth_account'
            ELSE 'linked'
        END AS linked_status
    FROM public.collaborators c
    LEFT JOIN auth.users au ON au.id = c.collaborator_user_id
    WHERE c.owner_id = v_owner_id
    ORDER BY c.created_at DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_month_member_sync_columns(target_table TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF target_table IS NULL OR target_table = '' THEN
        RETURN FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = target_table
    ) THEN
        RAISE EXCEPTION 'Unknown month table %', target_table;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ', target_table);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', target_table);

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_member(target_table TEXT, member_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    affected_rows INTEGER := 0;
BEGIN
    IF target_table IS NULL OR target_table = '' OR member_id IS NULL THEN
        RETURN FALSE;
    END IF;

    PERFORM public.ensure_month_member_sync_columns(target_table);

    EXECUTE format(
        'UPDATE public.%I SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
        target_table
    )
    USING member_id;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_owner_admin_override(
    p_owner_id UUID,
    p_month_table TEXT DEFAULT NULL,
    p_year INTEGER DEFAULT NULL,
    p_sunday_dates TEXT[] DEFAULT NULL,
    p_locked_date TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester UUID := auth.uid();
    v_owner_id UUID := p_owner_id;
    v_allowed BOOLEAN := FALSE;
BEGIN
    IF v_requester IS NULL OR v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_allowed := v_requester = v_owner_id OR EXISTS (
        SELECT 1
        FROM public.collaborators c
        WHERE c.owner_id = v_owner_id
          AND c.collaborator_user_id = v_requester
          AND c.status IN ('active', 'accepted')
          AND COALESCE(c.is_admin, false) = true
    );

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Only the workspace owner or an admin collaborator can update override settings';
    END IF;

    INSERT INTO public.user_preferences (
        user_id,
        admin_sticky_month,
        admin_sticky_year,
        admin_sticky_sundays,
        locked_default_date,
        updated_at
    ) VALUES (
        v_owner_id,
        p_month_table,
        p_year,
        p_sunday_dates,
        p_locked_date,
        NOW()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
        admin_sticky_month = EXCLUDED.admin_sticky_month,
        admin_sticky_year = EXCLUDED.admin_sticky_year,
        admin_sticky_sundays = EXCLUDED.admin_sticky_sundays,
        locked_default_date = EXCLUDED.locked_default_date,
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'owner_id', v_owner_id,
        'month_table', p_month_table,
        'locked_date', p_locked_date
    );
END;
$$;

DROP POLICY IF EXISTS "Collaborators can view invitations to them" ON public.collaborators;
DROP POLICY IF EXISTS "Owners can delete own collaborators" ON public.collaborators;
DROP POLICY IF EXISTS "Owners can insert collaborators" ON public.collaborators;
DROP POLICY IF EXISTS "Owners can update own collaborators" ON public.collaborators;
DROP POLICY IF EXISTS "Owners can view own collaborators" ON public.collaborators;
DROP POLICY IF EXISTS collaborators_owner_manage ON public.collaborators;
DROP POLICY IF EXISTS collaborators_self_read ON public.collaborators;

ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;

CREATE POLICY collaborators_owner_manage ON public.collaborators
FOR ALL TO authenticated
USING (owner_id = (SELECT auth.uid()))
WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY collaborators_self_read ON public.collaborators
FOR SELECT TO authenticated
USING (collaborator_user_id = (SELECT auth.uid()));

REVOKE ALL ON FUNCTION public.list_workspace_collaborators(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_workspace_collaborators(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_month_member_sync_columns(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_month_member_sync_columns(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.soft_delete_member(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_member(TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.update_owner_admin_override(UUID, TEXT, INTEGER, TEXT[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_owner_admin_override(UUID, TEXT, INTEGER, TEXT[], TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.list_workspace_collaborators(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_month_member_sync_columns(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_member(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_owner_admin_override(UUID, TEXT, INTEGER, TEXT[], TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
