-- Fix update_tag function
CREATE OR REPLACE FUNCTION update_tag(
    p_tag_id UUID,
    p_owner_id UUID,
    p_name TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_name TEXT;
    v_current_color TEXT;
BEGIN
    -- Get current values
    SELECT tags.name, tags.color INTO v_current_name, v_current_color
    FROM tags WHERE tags.id = p_tag_id AND tags.owner_id = p_owner_id;
    
    IF v_current_name IS NULL THEN
        RAISE EXCEPTION 'Tag not found or access denied';
    END IF;
    
    -- Check for duplicate name if name is being changed
    IF p_name IS NOT NULL AND p_name != v_current_name THEN
        IF EXISTS (SELECT 1 FROM tags WHERE tags.owner_id = p_owner_id AND tags.name = p_name AND tags.id != p_tag_id) THEN
            RAISE EXCEPTION 'A tag with this name already exists';
        END IF;
    END IF;
    
    UPDATE tags
    SET 
        name = COALESCE(p_name, v_current_name),
        color = COALESCE(p_color, v_current_color),
        updated_at = NOW()
    WHERE tags.id = p_tag_id AND tags.owner_id = p_owner_id;
    
    RETURN TRUE;
END;
$$;;
