-- Tag Management System for Collaborative Dashboard
-- This migration creates tables for managing tags that can be assigned to members

-- Create tags table (for workspace/owner-level tag definitions)
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1', -- Default indigo color
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique tag names per owner
    CONSTRAINT unique_owner_tag UNIQUE (owner_id, name)
);

-- Create member_tags junction table (many-to-many between tags and members)
CREATE TABLE IF NOT EXISTS member_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    member_id UUID NOT NULL, -- References the member in their monthly table
    table_name TEXT NOT NULL, -- The monthly table where the member belongs
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique tag-member combinations
    CONSTRAINT unique_member_tag UNIQUE (tag_id, member_id, table_name)
);

-- Enable Row Level Security
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tags table
-- Owners can perform any operation on their own tags
CREATE POLICY "Owners can manage their own tags" ON tags
    FOR ALL
    USING (auth.uid() = owner_id);

-- RLS Policies for member_tags table
-- Owners can manage tags for their workspace members
CREATE POLICY "Owners can manage member tags" ON member_tags
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM tags
            WHERE tags.id = member_tags.tag_id
            AND tags.owner_id = auth.uid()
        )
    );

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tags_owner_id ON tags(owner_id);
CREATE INDEX IF NOT EXISTS idx_member_tags_tag_id ON member_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_member_tags_member_id ON member_tags(member_id);
CREATE INDEX IF NOT EXISTS idx_member_tags_table_name ON member_tags(table_name);

-- Create function to get tags for a specific owner (workspace)
CREATE OR REPLACE FUNCTION get_workspace_tags(p_owner_id UUID)
RETURNS TABLE(
    id UUID,
    name TEXT,
    color TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    member_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.name,
        t.color,
        t.created_at,
        t.updated_at,
        COUNT(mt.id)::BIGINT as member_count
    FROM tags t
    LEFT JOIN member_tags mt ON mt.tag_id = t.id
    WHERE t.owner_id = p_owner_id
    GROUP BY t.id, t.name, t.color, t.created_at, t.updated_at
    ORDER BY t.name;
END;
$$;

-- Create function to get tags for a specific member
CREATE OR REPLACE FUNCTION get_member_tags(p_member_id UUID, p_table_name TEXT)
RETURNS TABLE(
    id UUID,
    name TEXT,
    color TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.name, t.color
    FROM tags t
    INNER JOIN member_tags mt ON mt.tag_id = t.id
    WHERE mt.member_id = p_member_id 
    AND mt.table_name = p_table_name
    ORDER BY t.name;
END;
$$;

-- Create function to assign a tag to a member
CREATE OR REPLACE FUNCTION assign_tag_to_member(
    p_tag_id UUID,
    p_member_id UUID,
    p_table_name TEXT,
    p_owner_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tag_owner_id UUID;
BEGIN
    -- Verify the tag belongs to the owner
    SELECT owner_id INTO v_tag_owner_id FROM tags WHERE id = p_tag_id;
    
    IF v_tag_owner_id IS NULL OR v_tag_owner_id != p_owner_id THEN
        RAISE EXCEPTION 'Tag not found or access denied';
    END IF;
    
    -- Insert the member-tag association (ON CONFLICT do nothing)
    INSERT INTO member_tags (tag_id, member_id, table_name)
    VALUES (p_tag_id, p_member_id, p_table_name)
    ON CONFLICT (tag_id, member_id, table_name) DO NOTHING;
    
    RETURN TRUE;
END;
$$;

-- Create function to remove a tag from a member
CREATE OR REPLACE FUNCTION remove_tag_from_member(
    p_tag_id UUID,
    p_member_id UUID,
    p_table_name TEXT,
    p_owner_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tag_owner_id UUID;
BEGIN
    -- Verify the tag belongs to the owner
    SELECT owner_id INTO v_tag_owner_id FROM tags WHERE id = p_tag_id;
    
    IF v_tag_owner_id IS NULL OR v_tag_owner_id != p_owner_id THEN
        RAISE EXCEPTION 'Tag not found or access denied';
    END IF;
    
    DELETE FROM member_tags 
    WHERE tag_id = p_tag_id 
    AND member_id = p_member_id 
    AND table_name = p_table_name;
    
    RETURN TRUE;
END;
$$;

-- Create function to create a new tag
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
$$;

-- Create function to update a tag
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
$$;

-- Create function to delete a tag (also removes all member associations)
CREATE OR REPLACE FUNCTION delete_tag(
    p_tag_id UUID,
    p_owner_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Delete will cascade to member_tags due to ON DELETE CASCADE
    DELETE FROM tags WHERE id = p_tag_id AND owner_id = p_owner_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tag not found or access denied';
    END IF;
    
    RETURN TRUE;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_workspace_tags(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_member_tags(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_tag_to_member(UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_tag_from_member(UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_tag(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_tag(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_tag(UUID, UUID) TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE tags IS 'Stores tag definitions for workspace/owner';
COMMENT ON TABLE member_tags IS 'Junction table linking tags to members';
COMMENT ON FUNCTION get_workspace_tags(UUID) IS 'Retrieves all tags for a workspace with member count';
COMMENT ON FUNCTION get_member_tags(UUID, TEXT) IS 'Retrieves all tags assigned to a specific member';
