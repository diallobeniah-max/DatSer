ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS member_code_lookup_enabled boolean DEFAULT true;

ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS member_code_share_message_template text DEFAULT 'Hi. Thank you for being part of {workspace}. Your member pass code is {code}.';

UPDATE public.user_preferences
SET
  member_code_lookup_enabled = COALESCE(member_code_lookup_enabled, true),
  member_code_share_message_template = COALESCE(
    NULLIF(member_code_share_message_template, ''),
    'Hi. Thank you for being part of {workspace}. Your member pass code is {code}.'
  );
