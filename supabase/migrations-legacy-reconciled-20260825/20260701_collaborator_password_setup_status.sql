-- Improve collaborator login setup status: distinguish missing Auth users from Auth users
-- that exist but still need a password setup/reset flow.

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
            WHEN NULLIF(au.encrypted_password, '') IS NULL THEN 'needs_password_setup'
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
    ORDER BY c.created_at DESC NULLS LAST, c.updated_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_workspace_collaborators(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_workspace_collaborators(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_workspace_collaborators(UUID) TO authenticated;

COMMENT ON FUNCTION public.list_workspace_collaborators(UUID)
IS 'Lists collaborators for the owner/admin and includes safe login setup status without exposing auth secrets.';
