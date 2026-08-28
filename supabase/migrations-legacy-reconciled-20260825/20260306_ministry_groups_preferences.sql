ALTER TABLE IF EXISTS user_preferences
ADD COLUMN IF NOT EXISTS ministry_groups TEXT[];
