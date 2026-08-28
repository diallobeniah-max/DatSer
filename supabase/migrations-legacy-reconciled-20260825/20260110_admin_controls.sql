-- Migration: Admin Controls for Sticky Month and Sunday Dates
-- This migration adds support for admins to set default month and Sunday dates for all collaborators

-- Add admin preference columns to user_preferences table
ALTER TABLE user_preferences 
ADD COLUMN IF NOT EXISTS admin_sticky_month TEXT,
ADD COLUMN IF NOT EXISTS admin_sticky_year INTEGER,
ADD COLUMN IF NOT EXISTS admin_sticky_sundays TEXT[];

-- Create function to set default month for all collaborators
CREATE OR REPLACE FUNCTION set_collaborators_default_month(
    p_owner_id UUID,
    p_month_table TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Update all collaborators' preferences to use the sticky month
    UPDATE user_preferences
    SET 
        current_month_table = p_month_table,
        updated_at = NOW()
    WHERE user_id IN (
        SELECT DISTINCT 
            CASE 
                WHEN email ~ '^[a-f0-9-]{36}$' THEN email::uuid
                ELSE (SELECT id FROM auth.users WHERE email = collaborators.email LIMIT 1)
            END
        FROM collaborators
        WHERE owner_id = p_owner_id
        AND status IN ('pending', 'accepted', 'active')
    )
    AND user_id IS NOT NULL;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN v_count;
END;
$$;

-- Create function to set default Sunday dates for all collaborators
CREATE OR REPLACE FUNCTION set_collaborators_default_sundays(
    p_owner_id UUID,
    p_sunday_dates TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Update all collaborators' preferences to use the sticky Sundays
    UPDATE user_preferences
    SET 
        admin_sticky_sundays = p_sunday_dates,
        updated_at = NOW()
    WHERE user_id IN (
        SELECT DISTINCT 
            CASE 
                WHEN email ~ '^[a-f0-9-]{36}$' THEN email::uuid
                ELSE (SELECT id FROM auth.users WHERE email = collaborators.email LIMIT 1)
            END
        FROM collaborators
        WHERE owner_id = p_owner_id
        AND status IN ('pending', 'accepted', 'active')
    )
    AND user_id IS NOT NULL;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN v_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION set_collaborators_default_month(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION set_collaborators_default_sundays(UUID, TEXT[]) TO authenticated;

-- Add comment
COMMENT ON FUNCTION set_collaborators_default_month IS 'Sets the default month table for all collaborators of a workspace owner';
COMMENT ON FUNCTION set_collaborators_default_sundays IS 'Sets the default Sunday dates for all collaborators of a workspace owner';
