-- Reliable preference save foundation.
-- Additive only: does not delete or rewrite month tables or existing preference values.

alter table public.user_preferences
  add column if not exists revision bigint not null default 1,
  add column if not exists last_saved_by uuid,
  add column if not exists last_save_request_id text;

-- Ensure every authenticated profile has exactly one preference row.
insert into public.user_preferences (user_id)
select u.id
from auth.users u
on conflict (user_id) do nothing;

create table if not exists public.preference_save_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  target_user_id uuid not null,
  scope text not null check (scope in ('personal', 'workspace')),
  request_id text not null,
  previous_revision bigint not null,
  new_revision bigint not null,
  changed_keys text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (actor_id, target_user_id, scope, request_id)
);

revoke all on table public.preference_save_audit from public, anon, authenticated;

create or replace function public.touch_user_preferences_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.revision := greatest(coalesce(new.revision, 1), 1);
    new.last_saved_by := coalesce(new.last_saved_by, auth.uid());
  else
    if new.revision is null or new.revision <= old.revision then
      new.revision := old.revision + 1;
    end if;
    new.last_saved_by := coalesce(new.last_saved_by, auth.uid(), old.last_saved_by);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_touch_user_preferences_metadata on public.user_preferences;
create trigger trg_touch_user_preferences_metadata
before insert or update on public.user_preferences
for each row execute function public.touch_user_preferences_metadata();

create or replace function public.get_preference_bundle(p_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_personal public.user_preferences%rowtype;
  v_workspace public.user_preferences%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  perform public.authorize_workspace_actor(p_owner_id);

  insert into public.user_preferences (user_id, last_saved_by)
  values (v_actor_id, v_actor_id)
  on conflict (user_id) do nothing;

  insert into public.user_preferences (user_id, last_saved_by)
  values (p_owner_id, v_actor_id)
  on conflict (user_id) do nothing;

  select * into v_personal
  from public.user_preferences
  where user_id = v_actor_id;

  select * into v_workspace
  from public.user_preferences
  where user_id = p_owner_id;

  return jsonb_build_object(
    'success', true,
    'actor_id', v_actor_id,
    'owner_id', p_owner_id,
    'personal', to_jsonb(v_personal),
    'workspace', to_jsonb(v_workspace),
    'personal_revision', v_personal.revision,
    'workspace_revision', v_workspace.revision
  );
end;
$$;

create or replace function public.save_personal_preferences(
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
  v_before public.user_preferences%rowtype;
  v_after public.user_preferences%rowtype;
  v_unknown text;
  v_key text;
  v_allowed constant text[] := array[
    'theme','font_size','font_family','selected_month_table','badge_filter',
    'current_month_table','command_k_enabled','animations_enabled','reduced_motion',
    'high_contrast','focus_visible','performance_mode','theme_mode','calendar_mode',
    'manual_month_table','manual_sunday_date','manual_override_until',
    'settings_search_quick_actions_enabled','command_palette_auto_scan_settings',
    'haptic_feedback_enabled','haptic_feedback_strength','compact_ui_enabled',
    'mobile_dashboard_status_enabled','motion_and_sounds_enabled',
    'smart_compact_prompt_enabled','dashboard_member_columns'
  ];
  v_boolean_keys constant text[] := array[
    'command_k_enabled','animations_enabled','reduced_motion','high_contrast',
    'focus_visible','performance_mode','settings_search_quick_actions_enabled',
    'command_palette_auto_scan_settings','haptic_feedback_enabled',
    'compact_ui_enabled','mobile_dashboard_status_enabled',
    'motion_and_sounds_enabled','smart_compact_prompt_enabled'
  ];
  v_changed_keys text[];
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'Preferences must be a JSON object';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'Request id is required';
  end if;

  select string_agg(k, ', ' order by k)
  into v_unknown
  from jsonb_object_keys(p_preferences) k
  where not (k = any(v_allowed));
  if v_unknown is not null then
    raise exception 'Unsupported personal preference keys: %', v_unknown;
  end if;

  foreach v_key in array v_boolean_keys loop
    if p_preferences ? v_key and jsonb_typeof(p_preferences -> v_key) <> 'boolean' then
      raise exception 'Preference % must be boolean', v_key;
    end if;
  end loop;

  if p_preferences ? 'badge_filter'
     and jsonb_typeof(p_preferences -> 'badge_filter') not in ('object','array','null') then
    raise exception 'badge_filter must be JSON';
  end if;
  if p_preferences ? 'calendar_mode'
     and coalesce(p_preferences ->> 'calendar_mode','') not in ('auto','manual') then
    raise exception 'calendar_mode must be auto or manual';
  end if;
  if p_preferences ? 'theme_mode'
     and coalesce(p_preferences ->> 'theme_mode','') not in ('system','light','dark') then
    raise exception 'theme_mode must be system, light or dark';
  end if;
  if p_preferences ? 'dashboard_member_columns' then
    if jsonb_typeof(p_preferences -> 'dashboard_member_columns') <> 'number'
       or (p_preferences ->> 'dashboard_member_columns')::integer not between 1 and 4 then
      raise exception 'dashboard_member_columns must be between 1 and 4';
    end if;
  end if;
  if p_preferences ? 'haptic_feedback_strength'
     and jsonb_typeof(p_preferences -> 'haptic_feedback_strength') <> 'number' then
    raise exception 'haptic_feedback_strength must be numeric';
  end if;

  insert into public.user_preferences (user_id, last_saved_by)
  values (v_actor_id, v_actor_id)
  on conflict (user_id) do nothing;

  select * into v_before
  from public.user_preferences
  where user_id = v_actor_id
  for update;

  if v_before.last_save_request_id = p_request_id then
    return jsonb_build_object(
      'success', true,
      'scope', 'personal',
      'idempotent', true,
      'request_id', p_request_id,
      'revision', v_before.revision,
      'preferences', to_jsonb(v_before)
    );
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_before.revision then
    raise exception using
      errcode = '40001',
      message = format('Personal preferences changed on another device. Expected revision %s but current revision is %s.', p_expected_revision, v_before.revision);
  end if;

  update public.user_preferences up
  set
    theme = case when p_preferences ? 'theme' then nullif(p_preferences ->> 'theme','') else up.theme end,
    font_size = case when p_preferences ? 'font_size' then nullif(p_preferences ->> 'font_size','') else up.font_size end,
    font_family = case when p_preferences ? 'font_family' then nullif(p_preferences ->> 'font_family','') else up.font_family end,
    selected_month_table = case when p_preferences ? 'selected_month_table' then nullif(p_preferences ->> 'selected_month_table','') else up.selected_month_table end,
    badge_filter = case when p_preferences ? 'badge_filter' then p_preferences -> 'badge_filter' else up.badge_filter end,
    current_month_table = case when p_preferences ? 'current_month_table' then nullif(p_preferences ->> 'current_month_table','') else up.current_month_table end,
    command_k_enabled = case when p_preferences ? 'command_k_enabled' then (p_preferences ->> 'command_k_enabled')::boolean else up.command_k_enabled end,
    animations_enabled = case when p_preferences ? 'animations_enabled' then (p_preferences ->> 'animations_enabled')::boolean else up.animations_enabled end,
    reduced_motion = case when p_preferences ? 'reduced_motion' then (p_preferences ->> 'reduced_motion')::boolean else up.reduced_motion end,
    high_contrast = case when p_preferences ? 'high_contrast' then (p_preferences ->> 'high_contrast')::boolean else up.high_contrast end,
    focus_visible = case when p_preferences ? 'focus_visible' then (p_preferences ->> 'focus_visible')::boolean else up.focus_visible end,
    performance_mode = case when p_preferences ? 'performance_mode' then (p_preferences ->> 'performance_mode')::boolean else up.performance_mode end,
    theme_mode = case when p_preferences ? 'theme_mode' then p_preferences ->> 'theme_mode' else up.theme_mode end,
    calendar_mode = case when p_preferences ? 'calendar_mode' then p_preferences ->> 'calendar_mode' else up.calendar_mode end,
    manual_month_table = case when p_preferences ? 'manual_month_table' then nullif(p_preferences ->> 'manual_month_table','') else up.manual_month_table end,
    manual_sunday_date = case when p_preferences ? 'manual_sunday_date' then nullif(p_preferences ->> 'manual_sunday_date','')::date else up.manual_sunday_date end,
    manual_override_until = case when p_preferences ? 'manual_override_until' then nullif(p_preferences ->> 'manual_override_until','')::timestamptz else up.manual_override_until end,
    settings_search_quick_actions_enabled = case when p_preferences ? 'settings_search_quick_actions_enabled' then (p_preferences ->> 'settings_search_quick_actions_enabled')::boolean else up.settings_search_quick_actions_enabled end,
    command_palette_auto_scan_settings = case when p_preferences ? 'command_palette_auto_scan_settings' then (p_preferences ->> 'command_palette_auto_scan_settings')::boolean else up.command_palette_auto_scan_settings end,
    haptic_feedback_enabled = case when p_preferences ? 'haptic_feedback_enabled' then (p_preferences ->> 'haptic_feedback_enabled')::boolean else up.haptic_feedback_enabled end,
    haptic_feedback_strength = case when p_preferences ? 'haptic_feedback_strength' then (p_preferences ->> 'haptic_feedback_strength')::numeric else up.haptic_feedback_strength end,
    compact_ui_enabled = case when p_preferences ? 'compact_ui_enabled' then (p_preferences ->> 'compact_ui_enabled')::boolean else up.compact_ui_enabled end,
    mobile_dashboard_status_enabled = case when p_preferences ? 'mobile_dashboard_status_enabled' then (p_preferences ->> 'mobile_dashboard_status_enabled')::boolean else up.mobile_dashboard_status_enabled end,
    motion_and_sounds_enabled = case when p_preferences ? 'motion_and_sounds_enabled' then (p_preferences ->> 'motion_and_sounds_enabled')::boolean else up.motion_and_sounds_enabled end,
    smart_compact_prompt_enabled = case when p_preferences ? 'smart_compact_prompt_enabled' then (p_preferences ->> 'smart_compact_prompt_enabled')::boolean else up.smart_compact_prompt_enabled end,
    dashboard_member_columns = case when p_preferences ? 'dashboard_member_columns' then (p_preferences ->> 'dashboard_member_columns')::smallint else up.dashboard_member_columns end,
    revision = up.revision + 1,
    last_saved_by = v_actor_id,
    last_save_request_id = p_request_id
  where up.user_id = v_actor_id
  returning * into v_after;

  select coalesce(array_agg(k order by k), '{}'::text[])
  into v_changed_keys
  from jsonb_object_keys(p_preferences) k;

  insert into public.preference_save_audit (
    actor_id, target_user_id, scope, request_id,
    previous_revision, new_revision, changed_keys
  ) values (
    v_actor_id, v_actor_id, 'personal', p_request_id,
    v_before.revision, v_after.revision, v_changed_keys
  ) on conflict do nothing;

  return jsonb_build_object(
    'success', true,
    'scope', 'personal',
    'idempotent', false,
    'request_id', p_request_id,
    'revision', v_after.revision,
    'preferences', to_jsonb(v_after)
  );
end;
$$;

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
    'member_codes_enabled','member_code_quick_pass_enabled','member_code_show_logo',
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
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;
  if p_owner_id is null then
    raise exception 'Workspace owner id is required';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'Preferences must be a JSON object';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'Request id is required';
  end if;

  v_allowed_actor := v_actor_id = p_owner_id or exists (
    select 1
    from public.collaborators c
    where c.owner_id = p_owner_id
      and c.status in ('accepted','active')
      and coalesce(c.is_admin, false) = true
      and (
        c.collaborator_user_id = v_actor_id
        or lower(coalesce(c.email, c.collaborator_email, '')) = lower(coalesce(auth.jwt() ->> 'email',''))
      )
  );
  if not v_allowed_actor then
    raise exception 'Only the workspace owner or an admin collaborator can save workspace settings';
  end if;

  select string_agg(k, ', ' order by k)
  into v_unknown
  from jsonb_object_keys(p_preferences) k
  where not (k = any(v_allowed));
  if v_unknown is not null then
    raise exception 'Unsupported workspace preference keys: %', v_unknown;
  end if;

  foreach v_key in array v_boolean_keys loop
    if p_preferences ? v_key and jsonb_typeof(p_preferences -> v_key) <> 'boolean' then
      raise exception 'Preference % must be boolean', v_key;
    end if;
  end loop;

  if p_preferences ? 'member_code_badge_style'
     and coalesce(p_preferences ->> 'member_code_badge_style','') not in ('auto','soft','outline','solid','circle','coral','green','crimson','magenta','amber') then
    raise exception 'Unsupported member code badge style';
  end if;
  if p_preferences ? 'member_code_card_style'
     and coalesce(p_preferences ->> 'member_code_card_style','') not in ('wave','glass','gradient','classic','premium','neon','cosmic') then
    raise exception 'Unsupported member code card style';
  end if;
  if p_preferences ? 'member_code_accent_color'
     and coalesce(p_preferences ->> 'member_code_accent_color','') not in ('orange','blue','purple','green','teal') then
    raise exception 'Unsupported member code accent color';
  end if;
  if p_preferences ? 'guided_form_settings'
     and jsonb_typeof(p_preferences -> 'guided_form_settings') not in ('object','null') then
    raise exception 'guided_form_settings must be a JSON object';
  end if;
  if p_preferences ? 'historical_search_settings'
     and jsonb_typeof(p_preferences -> 'historical_search_settings') not in ('object','null') then
    raise exception 'historical_search_settings must be a JSON object';
  end if;

  insert into public.user_preferences (user_id, last_saved_by)
  values (p_owner_id, v_actor_id)
  on conflict (user_id) do nothing;

  select * into v_before
  from public.user_preferences
  where user_id = p_owner_id
  for update;

  if v_before.last_save_request_id = p_request_id then
    return jsonb_build_object(
      'success', true,
      'scope', 'workspace',
      'idempotent', true,
      'request_id', p_request_id,
      'revision', v_before.revision,
      'preferences', to_jsonb(v_before)
    );
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_before.revision then
    raise exception using
      errcode = '40001',
      message = format('Workspace preferences changed on another device. Expected revision %s but current revision is %s.', p_expected_revision, v_before.revision);
  end if;

  update public.user_preferences up
  set
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
    revision = up.revision + 1,
    last_saved_by = v_actor_id,
    last_save_request_id = p_request_id
  where up.user_id = p_owner_id
  returning * into v_after;

  select coalesce(array_agg(k order by k), '{}'::text[])
  into v_changed_keys
  from jsonb_object_keys(p_preferences) k;

  insert into public.preference_save_audit (
    actor_id, target_user_id, scope, request_id,
    previous_revision, new_revision, changed_keys
  ) values (
    v_actor_id, p_owner_id, 'workspace', p_request_id,
    v_before.revision, v_after.revision, v_changed_keys
  ) on conflict do nothing;

  return jsonb_build_object(
    'success', true,
    'scope', 'workspace',
    'idempotent', false,
    'request_id', p_request_id,
    'revision', v_after.revision,
    'preferences', to_jsonb(v_after)
  );
end;
$$;

revoke all on function public.get_preference_bundle(uuid) from public, anon;
grant execute on function public.get_preference_bundle(uuid) to authenticated;

revoke all on function public.save_personal_preferences(jsonb, bigint, text) from public, anon;
grant execute on function public.save_personal_preferences(jsonb, bigint, text) to authenticated;

revoke all on function public.save_workspace_preferences(uuid, jsonb, bigint, text) from public, anon;
grant execute on function public.save_workspace_preferences(uuid, jsonb, bigint, text) to authenticated;

comment on function public.get_preference_bundle(uuid) is
'Loads separate personal and workspace preference rows for the authenticated actor. Creates only missing default rows; never deletes or resets saved values.';

comment on function public.save_personal_preferences(jsonb, bigint, text) is
'Validated, revision-aware, idempotent save path for personal UI preferences.';

comment on function public.save_workspace_preferences(uuid, jsonb, bigint, text) is
'Validated, owner/admin-only, revision-aware, idempotent save path for safe workspace settings. Dedicated destructive or structural settings remain on their specialized RPCs.';;
