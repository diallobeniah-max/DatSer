-- Function to update ministry groups with owner verification
-- Uses SECURITY DEFINER to allow authorized updates
CREATE OR REPLACE FUNCTION update_ministry_groups(
    p_ministry_groups TEXT[],
    p_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_requester_id UUID := auth.uid();
    v_requester_email TEXT;
BEGIN
    -- Get the requester's email from auth.users (allowed because of SECURITY DEFINER)
    SELECT email INTO v_requester_email 
    FROM auth.users 
    WHERE id = v_requester_id
    LIMIT 1;

    -- Check if the requester is the owner OR a collaborator
    IF v_requester_id = p_owner_id OR EXISTS (
        SELECT 1 FROM collaborators
        WHERE owner_id = p_owner_id
        AND (
            email = v_requester_email
            OR email ILIKE v_requester_email
        )
        AND status IN ('accepted', 'active')
    ) THEN
        -- Update the ministry groups
        UPDATE user_preferences
        SET 
            ministry_groups = p_ministry_groups,
            updated_at = NOW()
        WHERE user_id = p_owner_id;

        -- Create user_preferences entry if it doesn't exist
        IF NOT FOUND THEN
            INSERT INTO user_preferences (user_id, ministry_groups, updated_at)
            VALUES (p_owner_id, p_ministry_groups, NOW());
        END IF;

        -- Sync to collaborators (optional but good for consistency)
        PERFORM set_collaborators_ministry_groups(p_owner_id, p_ministry_groups);
        RETURN;
    END IF;

    -- If neither, deny access
    RAISE EXCEPTION 'Not authorized to update ministries for this workspace';
END;
$$;

GRANT EXECUTE ON FUNCTION update_ministry_groups(TEXT[], UUID) TO authenticated;
