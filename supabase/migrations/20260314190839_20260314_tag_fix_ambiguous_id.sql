-- Fix create_tag function - remove ambiguous column reference
CREATE OR REPLACE FUNCTION create_tag(
    p_owner_id UUID,
    p_name TEXT,
    p_color TEXT DEFAULT '#6366f1'
)
RETURNS TABLE(id UUID, name TEXT, color TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tag_id UUID;
    v_created_at TIMESTAMPTZ;
BEGIN
    -- Check if tag with same name already exists
    IF EXISTS (SELECT 1 FROM tags WHERE tags.owner_id = p_owner_id AND tags.name = p_name) THEN
        RAISE EXCEPTION 'A tag with this name already exists';
    END IF;
    
    INSERT INTO tags (owner_id, name, color)
    VALUES (p_owner_id, p_name, p_color)
    RETURNING tags.id, tags.created_at INTO v_tag_id, v_created_at;
    
    RETURN QUERY
    SELECT v_tag_id, p_name, p_color, v_created_at;
END;
$$;;
