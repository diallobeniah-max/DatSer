CREATE OR REPLACE FUNCTION set_collaborators_ministry_groups(
    p_owner_id UUID,
    p_ministry_groups TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    INSERT INTO user_preferences (user_id, ministry_groups, updated_at)
    SELECT
        collaborator_id,
        p_ministry_groups,
        NOW()
    FROM (
        SELECT DISTINCT
            CASE
                WHEN email ~ '^[a-f0-9-]{36}$' THEN email::uuid
                ELSE (SELECT id FROM auth.users WHERE email = collaborators.email LIMIT 1)
            END AS collaborator_id
        FROM collaborators
        WHERE owner_id = p_owner_id
          AND status IN ('pending', 'accepted', 'active')
    ) AS resolved_collaborators
    WHERE collaborator_id IS NOT NULL
    ON CONFLICT (user_id) DO UPDATE
    SET
        ministry_groups = EXCLUDED.ministry_groups,
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
