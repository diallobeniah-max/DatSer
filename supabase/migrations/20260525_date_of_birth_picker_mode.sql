ALTER TABLE IF EXISTS public.user_preferences
ADD COLUMN IF NOT EXISTS date_of_birth_picker_mode TEXT DEFAULT 'combined';

ALTER TABLE IF EXISTS public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_date_of_birth_picker_mode_check;

ALTER TABLE IF EXISTS public.user_preferences
ADD CONSTRAINT user_preferences_date_of_birth_picker_mode_check
CHECK (date_of_birth_picker_mode IN ('month-year-first', 'combined'));
