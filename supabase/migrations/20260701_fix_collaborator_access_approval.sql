CREATE OR REPLACE FUNCTION public.get_current_user_access_context()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT;
    v_collab public.collaborators%ROWTYPE;
    v_is_owner BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('has_access', false, 'reason', 'not_authenticated');
    END IF;

    SELECT LOWER(email)
    INTO v_email
    FROM auth.users
    WHERE id = v_user_id;

    SELECT *
    INTO v_collab
    FROM public.collaborators
    WHERE status IN ('active', 'accepted')
      AND (
        collaborator_user_id = v_user_id
        OR (
          v_email IS NOT NULL
          AND LOWER(COALESCE(email, collaborator_email)) = v_email
        )
      )
    ORDER BY collaborator_user_id IS NOT NULL DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1;

    IF v_collab.id IS NOT NULL THEN
        IF v_collab.collaborator_user_id IS NULL THEN
            UPDATE public.collaborators
            SET
                collaborator_user_id = v_user_id,
                status = 'active',
                accepted_at = COALESCE(accepted_at, NOW())
            WHERE id = v_collab.id
            RETURNING * INTO v_collab;
        END IF;

        RETURN jsonb_build_object(
            'has_access', true,
            'is_owner', false,
            'is_collaborator', true,
            'owner_id', v_collab.owner_id,
            'status', v_collab.status,
            'is_admin_collaborator', COALESCE(v_collab.is_admin, false)
        );
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.user_preferences WHERE user_id = v_user_id
        UNION ALL
        SELECT 1 FROM public.user_month_tables WHERE user_id = v_user_id
        LIMIT 1
    )
    INTO v_is_owner;

    RETURN jsonb_build_object(
        'has_access', COALESCE(v_is_owner, false),
        'is_owner', COALESCE(v_is_owner, false),
        'is_collaborator', false,
        'owner_id', CASE WHEN COALESCE(v_is_owner, false) THEN v_user_id ELSE NULL END,
        'status', CASE WHEN COALESCE(v_is_owner, false) THEN 'owner' ELSE 'denied' END,
        'is_admin_collaborator', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_existing_collaborators_for_owner(p_owner_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id UUID := COALESCE(p_owner_id, auth.uid());
    v_normalized INTEGER := 0;
    v_linked INTEGER := 0;
    v_approved INTEGER := 0;
    v_still_pending INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL OR v_owner_id IS NULL OR auth.uid() <> v_owner_id THEN
        RAISE EXCEPTION 'Only the workspace owner can approve collaborators';
    END IF;

    UPDATE public.collaborators
    SET
        email = LOWER(COALESCE(NULLIF(TRIM(email), ''), NULLIF(TRIM(collaborator_email), ''))),
        collaborator_email = LOWER(COALESCE(NULLIF(TRIM(collaborator_email), ''), NULLIF(TRIM(email), ''))),
        updated_at = NOW()
    WHERE owner_id = v_owner_id
      AND COALESCE(email, collaborator_email) IS NOT NULL;
    GET DIAGNOSTICS v_normalized = ROW_COUNT;

    UPDATE public.collaborators c
    SET
        collaborator_user_id = au.id,
        accepted_at = COALESCE(c.accepted_at, NOW()),
        updated_at = NOW()
    FROM auth.users au
    WHERE c.owner_id = v_owner_id
      AND c.collaborator_user_id IS NULL
      AND c.status <> 'disabled'
      AND LOWER(au.email) = LOWER(COALESCE(c.email, c.collaborator_email));
    GET DIAGNOSTICS v_linked = ROW_COUNT;

    UPDATE public.collaborators
    SET
        status = 'active',
        accepted_at = COALESCE(accepted_at, NOW()),
        updated_at = NOW()
    WHERE owner_id = v_owner_id
      AND status IN ('pending', 'accepted')
      AND collaborator_user_id IS NOT NULL;
    GET DIAGNOSTICS v_approved = ROW_COUNT;

    SELECT COUNT(*)
    INTO v_still_pending
    FROM public.collaborators
    WHERE owner_id = v_owner_id
      AND status = 'pending'
      AND collaborator_user_id IS NULL;

    RETURN jsonb_build_object(
        'ok', true,
        'normalized', v_normalized,
        'linked', v_linked,
        'approved', v_approved,
        'still_pending', v_still_pending
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_user_access_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_existing_collaborators_for_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_user_access_context() FROM anon;
REVOKE ALL ON FUNCTION public.approve_existing_collaborators_for_owner(UUID) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_current_user_access_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_existing_collaborators_for_owner(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
