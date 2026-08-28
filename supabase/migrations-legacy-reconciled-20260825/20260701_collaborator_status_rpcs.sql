CREATE OR REPLACE FUNCTION public.activate_collaborator(p_collaborator_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id UUID := auth.uid();
    v_row public.collaborators%ROWTYPE;
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    UPDATE public.collaborators
    SET
        status = 'active',
        updated_at = NOW()
    WHERE id = p_collaborator_id
      AND owner_id = v_owner_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Collaborator not found or access denied';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_row.id,
        'email', v_row.email,
        'status', v_row.status,
        'is_admin', COALESCE(v_row.is_admin, false)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_collaborator(p_collaborator_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id UUID := auth.uid();
    v_row public.collaborators%ROWTYPE;
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    UPDATE public.collaborators
    SET
        status = 'disabled',
        is_admin = FALSE,
        updated_at = NOW()
    WHERE id = p_collaborator_id
      AND owner_id = v_owner_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Collaborator not found or access denied';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_row.id,
        'email', v_row.email,
        'status', v_row.status,
        'is_admin', COALESCE(v_row.is_admin, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_collaborator(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_collaborator(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_collaborator(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.disable_collaborator(UUID) FROM anon;

GRANT EXECUTE ON FUNCTION public.activate_collaborator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_collaborator(UUID) TO authenticated;
