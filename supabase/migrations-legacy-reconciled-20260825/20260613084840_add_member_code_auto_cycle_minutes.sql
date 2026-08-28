ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS member_code_auto_cycle_minutes smallint DEFAULT 30;

UPDATE public.user_preferences
SET member_code_auto_cycle_minutes = 30
WHERE member_code_auto_cycle_minutes IS NULL
   OR member_code_auto_cycle_minutes NOT IN (15, 30, 60);

ALTER TABLE public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_member_code_auto_cycle_minutes_check;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_member_code_auto_cycle_minutes_check
CHECK (member_code_auto_cycle_minutes IN (15, 30, 60));
