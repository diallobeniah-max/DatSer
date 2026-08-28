-- Drop ministry_groups column from user_preferences table
ALTER TABLE user_preferences
DROP COLUMN IF EXISTS ministry_groups;
