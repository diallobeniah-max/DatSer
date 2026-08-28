-- Function to allow owners AND collaborators to update the shared ministry list (stored on owner's row)
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
    v_requester_email TEXT;
BEGIN
    -- 1. Check if the requester is the owner
    IF v_requester_id = p_owner_id THEN
        -- Owner updating their own list
        UPDATE user_preferences
        SET 
            ministry_groups = p_ministry_groups,
            updated_at = NOW()
        WHERE user_id = p_owner_id;

        -- Sync to collaborators (optional but good for consistency)
        PERFORM set_collaborators_ministry_groups(p_owner_id, p_ministry_groups);
        RETURN;
    END IF;

    -- 2. If not owner, check if requester is a valid collaborator
    SELECT email INTO v_requester_email FROM auth.users WHERE id = v_requester_id;

    IF EXISTS (
        SELECT 1 FROM collaborators
        WHERE owner_id = p_owner_id
        AND (
            email = v_requester_email
            OR
            -- Handle cases where email might be stored differently or mapped
            email ILIKE v_requester_email
        )
        AND status IN ('accepted', 'active')
    ) THEN
        -- Collaborator is authorized to update owner's preferences
        UPDATE user_preferences
        SET 
            ministry_groups = p_ministry_groups,
            updated_at = NOW()
        WHERE user_id = p_owner_id;

        -- Sync to collaborators (so everyone sees the update)
        PERFORM set_collaborators_ministry_groups(p_owner_id, p_ministry_groups);
        RETURN;
    END IF;

    -- 3. If neither, deny access
    RAISE EXCEPTION 'Not authorized to update ministries for this workspace';
END;
$$;

GRANT EXECUTE ON FUNCTION update_ministry_groups(TEXT[], UUID) TO authenticated;;
