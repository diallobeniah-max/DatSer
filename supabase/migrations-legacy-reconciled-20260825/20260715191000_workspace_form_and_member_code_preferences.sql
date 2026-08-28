-- Keep workspace Member Codes and member-form visibility settings available to
-- owners and collaborators across devices. Plain preference values only; no
-- authentication secrets are stored here.
alter table public.user_preferences
  add column if not exists member_code_lookup_enabled boolean not null default true,
  add column if not exists member_code_share_message_template text,
  add column if not exists guided_form_settings jsonb not null default '{
    "showVisitorField": false,
    "showTagsField": false,
    "showNotesField": false
  }'::jsonb;

comment on column public.user_preferences.guided_form_settings is
  'Workspace member-form visibility and guided workflow preferences.';

update public.user_preferences
set guided_form_settings = coalesce(guided_form_settings, '{}'::jsonb) || jsonb_build_object(
  'showVisitorField', coalesce((guided_form_settings ->> 'showVisitorField')::boolean, false),
  'showTagsField', coalesce((guided_form_settings ->> 'showTagsField')::boolean, false),
  'showNotesField', coalesce((guided_form_settings ->> 'showNotesField')::boolean, false)
);
