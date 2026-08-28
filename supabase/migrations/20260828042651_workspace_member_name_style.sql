-- Workspace-wide, display-only preference. Member records are intentionally untouched.
alter table public.user_preferences
  add column if not exists member_name_style text not null default 'title';

update public.user_preferences
set member_name_style = 'title'
where member_name_style is null
   or member_name_style not in ('lower', 'title', 'upper');

alter table public.user_preferences
  drop constraint if exists user_preferences_member_name_style_check;

alter table public.user_preferences
  add constraint user_preferences_member_name_style_check
  check (member_name_style in ('lower', 'title', 'upper'));

create or replace function public.save_workspace_preferences(
  p_owner_id uuid,
  p_preferences jsonb,
  p_expected_revision bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_allowed_actor boolean := false;
  v_before public.user_preferences%rowtype;
  v_after public.user_preferences%rowtype;
  v_unknown text;
  v_key text;
  v_allowed constant text[] := array[
    'member_name_style','member_codes_enabled','member_code_quick_pass_enabled','member_code_show_logo',
    'member_code_show_photo','member_code_show_email','member_code_auto_profile_enabled',
    'member_code_badge_style','member_code_card_style','member_code_accent_color',
    'member_code_church_name','member_filter_button_enabled',
    'member_search_tray_delete_enabled','workspace_member_codes_enabled',
    'member_code_logo_url','member_code_turbo_enabled',
    'member_code_turbo_notification_enabled','member_code_lookup_enabled',
    'member_code_share_message_template','guided_form_settings','historical_search_settings'
  ];
  v_boolean_keys constant text[] := array[
    'member_codes_enabled','member_code_quick_pass_enabled','member_code_show_logo',
    'member_code_show_photo','member_code_show_email','member_code_auto_profile_enabled',
    'member_filter_button_enabled','member_search_tray_delete_enabled',
    'workspace_member_codes_enabled','member_code_turbo_enabled',
    'member_code_turbo_notification_enabled','member_code_lookup_enabled'
  ];
  v_changed_keys text[];
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if p_owner_id is null then raise exception 'Workspace owner id is required'; end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then raise exception 'Preferences must be a JSON object'; end if;
  if p_request_id is null or btrim(p_request_id) = '' then raise exception 'Request id is required'; end if;

  v_allowed_actor := v_actor_id = p_owner_id or exists (
    select 1 from public.collaborators c
    where c.owner_id = p_owner_id
      and c.status in ('accepted','active')
      and coalesce(c.is_admin, false) = true
      and (c.collaborator_user_id = v_actor_id or lower(coalesce(c.email, c.collaborator_email, '')) = lower(coalesce(auth.jwt() ->> 'email','')))
  );
  if not v_allowed_actor then raise exception 'Only the workspace owner or an admin collaborator can save workspace settings'; end if;

  select string_agg(k, ', ' order by k) into v_unknown
  from jsonb_object_keys(p_preferences) k where not (k = any(v_allowed));
  if v_unknown is not null then raise exception 'Unsupported workspace preference keys: %', v_unknown; end if;

  foreach v_key in array v_boolean_keys loop
    if p_preferences ? v_key and jsonb_typeof(p_preferences -> v_key) <> 'boolean' then
      raise exception 'Preference % must be boolean', v_key;
    end if;
  end loop;
  if p_preferences ? 'member_name_style' and coalesce(p_preferences ->> 'member_name_style','') not in ('lower','title','upper') then raise exception 'Unsupported member name style'; end if;
  if p_preferences ? 'member_code_badge_style' and coalesce(p_preferences ->> 'member_code_badge_style','') not in ('auto','soft','outline','solid','circle','coral','green','crimson','magenta','amber') then raise exception 'Unsupported member code badge style'; end if;
  if p_preferences ? 'member_code_card_style' and coalesce(p_preferences ->> 'member_code_card_style','') not in ('wave','glass','gradient','classic','premium','neon','cosmic') then raise exception 'Unsupported member code card style'; end if;
  if p_preferences ? 'member_code_accent_color' and coalesce(p_preferences ->> 'member_code_accent_color','') not in ('orange','blue','purple','green','teal') then raise exception 'Unsupported member code accent color'; end if;
  if p_preferences ? 'guided_form_settings' and jsonb_typeof(p_preferences -> 'guided_form_settings') not in ('object','null') then raise exception 'guided_form_settings must be a JSON object'; end if;
  if p_preferences ? 'historical_search_settings' and jsonb_typeof(p_preferences -> 'historical_search_settings') not in ('object','null') then raise exception 'historical_search_settings must be a JSON object'; end if;

  insert into public.user_preferences (user_id, last_saved_by) values (p_owner_id, v_actor_id) on conflict (user_id) do nothing;
  select * into v_before from public.user_preferences where user_id = p_owner_id for update;

  if v_before.last_save_request_id = p_request_id then
    return jsonb_build_object('success', true, 'scope', 'workspace', 'idempotent', true, 'request_id', p_request_id, 'revision', v_before.revision, 'preferences', to_jsonb(v_before));
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_before.revision then
    raise exception using errcode = '40001', message = format('Workspace preferences changed on another device. Expected revision %s but current revision is %s.', p_expected_revision, v_before.revision);
  end if;

  update public.user_preferences up set
    member_name_style = case when p_preferences ? 'member_name_style' then p_preferences ->> 'member_name_style' else up.member_name_style end,
    member_codes_enabled = case when p_preferences ? 'member_codes_enabled' then (p_preferences ->> 'member_codes_enabled')::boolean else up.member_codes_enabled end,
    member_code_quick_pass_enabled = case when p_preferences ? 'member_code_quick_pass_enabled' then (p_preferences ->> 'member_code_quick_pass_enabled')::boolean else up.member_code_quick_pass_enabled end,
    member_code_show_logo = case when p_preferences ? 'member_code_show_logo' then (p_preferences ->> 'member_code_show_logo')::boolean else up.member_code_show_logo end,
    member_code_show_photo = case when p_preferences ? 'member_code_show_photo' then (p_preferences ->> 'member_code_show_photo')::boolean else up.member_code_show_photo end,
    member_code_show_email = case when p_preferences ? 'member_code_show_email' then (p_preferences ->> 'member_code_show_email')::boolean else up.member_code_show_email end,
    member_code_auto_profile_enabled = case when p_preferences ? 'member_code_auto_profile_enabled' then (p_preferences ->> 'member_code_auto_profile_enabled')::boolean else up.member_code_auto_profile_enabled end,
    member_code_badge_style = case when p_preferences ? 'member_code_badge_style' then p_preferences ->> 'member_code_badge_style' else up.member_code_badge_style end,
    member_code_card_style = case when p_preferences ? 'member_code_card_style' then p_preferences ->> 'member_code_card_style' else up.member_code_card_style end,
    member_code_accent_color = case when p_preferences ? 'member_code_accent_color' then p_preferences ->> 'member_code_accent_color' else up.member_code_accent_color end,
    member_code_church_name = case when p_preferences ? 'member_code_church_name' then nullif(p_preferences ->> 'member_code_church_name','') else up.member_code_church_name end,
    member_filter_button_enabled = case when p_preferences ? 'member_filter_button_enabled' then (p_preferences ->> 'member_filter_button_enabled')::boolean else up.member_filter_button_enabled end,
    member_search_tray_delete_enabled = case when p_preferences ? 'member_search_tray_delete_enabled' then (p_preferences ->> 'member_search_tray_delete_enabled')::boolean else up.member_search_tray_delete_enabled end,
    workspace_member_codes_enabled = case when p_preferences ? 'workspace_member_codes_enabled' then (p_preferences ->> 'workspace_member_codes_enabled')::boolean else up.workspace_member_codes_enabled end,
    member_code_logo_url = case when p_preferences ? 'member_code_logo_url' then nullif(p_preferences ->> 'member_code_logo_url','') else up.member_code_logo_url end,
    member_code_turbo_enabled = case when p_preferences ? 'member_code_turbo_enabled' then (p_preferences ->> 'member_code_turbo_enabled')::boolean else up.member_code_turbo_enabled end,
    member_code_turbo_notification_enabled = case when p_preferences ? 'member_code_turbo_notification_enabled' then (p_preferences ->> 'member_code_turbo_notification_enabled')::boolean else up.member_code_turbo_notification_enabled end,
    member_code_lookup_enabled = case when p_preferences ? 'member_code_lookup_enabled' then (p_preferences ->> 'member_code_lookup_enabled')::boolean else up.member_code_lookup_enabled end,
    member_code_share_message_template = case when p_preferences ? 'member_code_share_message_template' then p_preferences ->> 'member_code_share_message_template' else up.member_code_share_message_template end,
    guided_form_settings = case when p_preferences ? 'guided_form_settings' then p_preferences -> 'guided_form_settings' else up.guided_form_settings end,
    historical_search_settings = case when p_preferences ? 'historical_search_settings' then p_preferences -> 'historical_search_settings' else up.historical_search_settings end,
    revision = up.revision + 1, last_saved_by = v_actor_id, last_save_request_id = p_request_id
  where up.user_id = p_owner_id returning * into v_after;

  select coalesce(array_agg(k order by k), '{}'::text[]) into v_changed_keys from jsonb_object_keys(p_preferences) k;
  insert into public.preference_save_audit (actor_id, target_user_id, scope, request_id, previous_revision, new_revision, changed_keys)
  values (v_actor_id, p_owner_id, 'workspace', p_request_id, v_before.revision, v_after.revision, v_changed_keys) on conflict do nothing;

  return jsonb_build_object('success', true, 'scope', 'workspace', 'idempotent', false, 'request_id', p_request_id, 'revision', v_after.revision, 'preferences', to_jsonb(v_after));
end;
$$;

revoke all on function public.save_workspace_preferences(uuid, jsonb, bigint, text) from public, anon;
grant execute on function public.save_workspace_preferences(uuid, jsonb, bigint, text) to authenticated;
