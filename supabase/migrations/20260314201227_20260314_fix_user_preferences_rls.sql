-- Drop conflicting policies
DROP POLICY IF EXISTS "Users and collaborators can insert workspace preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can insert their own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can insert workspace preferences" ON user_preferences;

-- Create unified INSERT policy
CREATE POLICY "Users can insert preferences"
ON user_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Enable RLS if not already enabled
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;;
