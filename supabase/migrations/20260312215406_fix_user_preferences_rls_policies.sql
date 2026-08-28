-- Drop all existing policies to recreate them
DROP POLICY IF EXISTS "Users can read their own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can update their own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can insert their own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can delete their own preferences" ON public.user_preferences;

-- Ensure RLS is enabled
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: Allow users to read their own preferences
CREATE POLICY "Users can read their own preferences" 
ON public.user_preferences 
FOR SELECT USING (user_id = auth.uid());

-- Policy: Allow users to update their own preferences
CREATE POLICY "Users can update their own preferences" 
ON public.user_preferences 
FOR UPDATE USING (user_id = auth.uid());

-- Policy: Allow users to insert their own preferences
CREATE POLICY "Users can insert their own preferences" 
ON public.user_preferences 
FOR INSERT WITH CHECK (user_id = auth.uid());

-- Policy: Allow users to delete their own preferences
CREATE POLICY "Users can delete their own preferences" 
ON public.user_preferences 
FOR DELETE USING (user_id = auth.uid());

-- Grant basic permissions to roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO anon;

-- Grant permissions to postgres (for SECURITY DEFINER functions)
GRANT SELECT, UPDATE ON public.user_preferences TO postgres;
GRANT USAGE ON SCHEMA public TO postgres;;
