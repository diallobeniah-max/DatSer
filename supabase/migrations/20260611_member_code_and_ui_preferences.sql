ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_codes_enabled boolean DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_quick_pass_enabled boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_show_logo boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_show_photo boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_show_email boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_auto_profile_enabled boolean DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_badge_style text DEFAULT 'soft';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_card_style text DEFAULT 'wave';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_accent_color text DEFAULT 'orange';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_code_church_name text DEFAULT 'DatSer Church';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS workspace_member_codes_enabled boolean DEFAULT NULL;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_filter_button_enabled boolean DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS member_search_tray_delete_enabled boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS settings_search_quick_actions_enabled boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS command_palette_auto_scan_settings boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS haptic_feedback_enabled boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS haptic_feedback_strength numeric DEFAULT 1;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS compact_ui_enabled boolean DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS mobile_dashboard_status_enabled boolean DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS dashboard_member_columns smallint DEFAULT 3;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS motion_and_sounds_enabled boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS smart_compact_prompt_enabled boolean DEFAULT true;

ALTER TABLE public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_member_code_badge_style_check;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_member_code_badge_style_check
CHECK (member_code_badge_style IN ('auto', 'soft', 'outline', 'solid', 'circle', 'coral', 'green', 'crimson', 'magenta', 'amber'));

ALTER TABLE public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_member_code_card_style_check;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_member_code_card_style_check
CHECK (member_code_card_style IN ('wave', 'glass', 'gradient', 'classic', 'premium', 'neon', 'cosmic'));

ALTER TABLE public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_member_code_accent_color_check;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_member_code_accent_color_check
CHECK (member_code_accent_color IN ('orange', 'blue', 'purple', 'green', 'teal'));

ALTER TABLE public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_dashboard_member_columns_check;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_dashboard_member_columns_check
CHECK (dashboard_member_columns IN (1, 2, 3, 4));

UPDATE public.user_preferences
SET
  member_codes_enabled = COALESCE(member_codes_enabled, false),
  member_code_quick_pass_enabled = COALESCE(member_code_quick_pass_enabled, true),
  member_code_show_logo = COALESCE(member_code_show_logo, true),
  member_code_show_photo = COALESCE(member_code_show_photo, true),
  member_code_show_email = COALESCE(member_code_show_email, true),
  member_code_auto_profile_enabled = COALESCE(member_code_auto_profile_enabled, false),
  member_code_badge_style = COALESCE(member_code_badge_style, 'soft'),
  member_code_card_style = COALESCE(member_code_card_style, 'wave'),
  member_code_accent_color = COALESCE(member_code_accent_color, 'orange'),
  member_code_church_name = COALESCE(NULLIF(member_code_church_name, ''), 'DatSer Church'),
  workspace_member_codes_enabled = COALESCE(workspace_member_codes_enabled, member_codes_enabled),
  member_filter_button_enabled = COALESCE(member_filter_button_enabled, false),
  member_search_tray_delete_enabled = COALESCE(member_search_tray_delete_enabled, true),
  settings_search_quick_actions_enabled = COALESCE(settings_search_quick_actions_enabled, true),
  command_palette_auto_scan_settings = COALESCE(command_palette_auto_scan_settings, true),
  haptic_feedback_enabled = COALESCE(haptic_feedback_enabled, true),
  haptic_feedback_strength = COALESCE(haptic_feedback_strength, 1),
  compact_ui_enabled = COALESCE(compact_ui_enabled, false),
  mobile_dashboard_status_enabled = COALESCE(mobile_dashboard_status_enabled, false),
  dashboard_member_columns = CASE
    WHEN dashboard_member_columns IN (1, 2, 3, 4) THEN dashboard_member_columns
    ELSE 3
  END,
  motion_and_sounds_enabled = COALESCE(motion_and_sounds_enabled, true),
  smart_compact_prompt_enabled = COALESCE(smart_compact_prompt_enabled, true)
WHERE true;
