CREATE OR REPLACE FUNCTION update_ministry_groups(
    p_ministry_groups TEXT[],
    p_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_requester_id UUID := auth.uid();
BEGIN
    IF v_requester_id = p_owner_id OR EXISTS (
        SELECT 1
        FROM collaborators
        WHERE owner_id = p_owner_id
          AND (
            collaborator_user_id = v_requester_id
            OR EXISTS (
              SELECT 1
              FROM auth.users au
              WHERE au.id = v_requester_id
                AND (collaborators.email = au.email OR collaborators.email ILIKE au.email)
            )
          )
          AND status IN ('accepted', 'active')
    ) THEN
        INSERT INTO user_preferences (user_id, ministry_groups, updated_at)
        VALUES (p_owner_id, p_ministry_groups, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET
            ministry_groups = EXCLUDED.ministry_groups,
            updated_at = NOW();

        PERFORM set_collaborators_ministry_groups(p_owner_id, p_ministry_groups);
        RETURN;
    END IF;

    RAISE EXCEPTION 'Not authorized to update ministries for this workspace';
END;
$$;

GRANT EXECUTE ON FUNCTION update_ministry_groups(TEXT[], UUID) TO authenticated;;
