-- Paper Scan — server-side duplicate guard for durable member-create steps.
--
-- Additive migration that hardens the already-applied
-- `20260813170000_harden_paper_scan_final_save` durable member-create path
-- WITHOUT modifying that historical migration.
--
-- Why: the review-time duplicate check runs against a one-time snapshot of one
-- month. Two concurrent sessions (organizer + collaborator) can each decide
-- "new member" for the same logical person from their own stale snapshot, and
-- the existing member-create step only locks by the freshly generated member
-- UUID — which differs per session, so it cannot serialize the two creates.
--
-- This migration adds, at the exact moment of INSERT:
--   1. an identity-scoped advisory lock (normalized phone, or normalized name
--      when phone is absent) so two sessions creating the same likely person
--      serialize check -> decide -> insert;
--   2. a FRESH active-member candidate query scoped to the authorized workspace
--      and month;
--   3. a structured BLOCKED_DUPLICATE result (no INSERT, no member code, no
--      attendance) whenever a normalized phone + name match exists — unless the
--      immutable plan carries an explicit duplicate override for that row
--      (operator confirmed the person is genuinely distinct despite the
--      candidate).
--
-- Phones are NOT treated as identity: a shared family phone with a different
-- name never auto-merges; the lock only briefly serializes the two creates.
--
-- The function signature, authorization (permanent workspace actor + private
-- saved-scan ownership), immutable-plan semantics, per-step idempotency, and
-- member-code behavior are all preserved from the applied 1700 migration.

create or replace function public.paper_scan_normalize_phone_for_guard(p_value text)
returns text language sql immutable set search_path = pg_catalog, public, pg_temp as $$
  select case
    when left(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), 3) = '233'
         and length(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')) = 12
    then '0' || right(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), 9)
    else regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')
  end;
$$;
revoke all on function public.paper_scan_normalize_phone_for_guard(text) from public, anon;
grant execute on function public.paper_scan_normalize_phone_for_guard(text) to authenticated;

create or replace function public.paper_scan_normalize_name_for_guard(p_value text)
returns text language sql immutable set search_path = pg_catalog, public, pg_temp as $$
  select lower(regexp_replace(coalesce(p_value, ''), '[^a-z0-9]+', ' ', 'g'))
$$;
revoke all on function public.paper_scan_normalize_name_for_guard(text) from public, anon;
grant execute on function public.paper_scan_normalize_name_for_guard(text) to authenticated;

create or replace function public.paper_scan_identity_lock_key(p_owner_id uuid, p_phone text, p_name text)
returns bigint language sql immutable set search_path = pg_catalog, public, pg_temp as $$
  select hashtextextended(
    coalesce(p_owner_id::text, '') || ':' ||
    coalesce(nullif(public.paper_scan_normalize_phone_for_guard(p_phone), ''), public.paper_scan_normalize_name_for_guard(p_name)),
    0
  );
$$;
revoke all on function public.paper_scan_identity_lock_key(uuid, text, text) from public, anon;
grant execute on function public.paper_scan_identity_lock_key(uuid, text, text) to authenticated;

create or replace function public.paper_scan_execute_save_step(p_operation_id uuid, p_step_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  o public.paper_scan_save_operations%rowtype;
  s public.paper_scan_save_steps%rowtype;
  v_table text;
  v_column text;
  v_sql text;
  v_count integer := 0;
  v_has_deleted boolean;
  v_authorized boolean := false;
  v_row_number integer;
  v_row_key text;
  v_override_keys text[] := array[]::text[];
  v_norm_phone text;
  v_norm_name text;
  v_candidate_id uuid;
  v_candidate_name text;
  v_candidate_phone text;
begin
  v_actor := auth.uid();
  if v_actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A permanent authenticated user is required' using errcode = '42501';
  end if;
  select * into o from public.paper_scan_save_operations where id = p_operation_id for update;
  if not found then raise exception 'Unknown save operation' using errcode = '42501'; end if;
  perform public.require_permanent_workspace_actor(o.owner_id, false);
  if o.saved_scan_user_id <> v_actor then
    raise exception 'Final Save operation plan is private to its Saved Scan owner' using errcode = '42501';
  end if;
  if not exists (select 1 from public.paper_scan_saved ps where ps.id = o.saved_scan_id
    and ps.owner_id = o.owner_id and ps.user_id = o.saved_scan_user_id) then
    raise exception 'Saved Scan ownership no longer matches this operation' using errcode = '42501';
  end if;
  select * into s from public.paper_scan_save_steps where id = p_step_id and operation_id = o.id for update;
  if not found then raise exception 'Unknown save step' using errcode = '42501'; end if;
  v_authorized := true;
  if s.state = 'succeeded' then
    return coalesce(s.result, jsonb_build_object('success', true, 'step_id', s.id));
  end if;
  begin
    update public.paper_scan_save_steps set state = 'running', attempts = attempts + 1, updated_at = now() where id = s.id;
    v_table := public.workspace_month_table_for(o.owner_id, s.month_start);
    v_has_deleted := public.month_table_has_column(v_table, 'deleted_at');
    if s.kind = 'member-create' then
      perform pg_advisory_xact_lock(hashtextextended(s.member_id::text, 0));
      if coalesce(nullif(btrim(s.member_payload ->> 'Full Name'), ''), nullif(btrim(s.member_payload ->> 'full_name'), '')) is null then
        raise exception 'An approved name is required';
      end if;

      perform pg_advisory_xact_lock(public.paper_scan_identity_lock_key(
        o.owner_id,
        coalesce(s.member_payload ->> 'Phone Number', s.member_payload ->> 'phone_number'),
        coalesce(s.member_payload ->> 'Full Name', s.member_payload ->> 'full_name')
      ));

      v_row_number := coalesce(nullif(split_part(s.step_key, ':', 1), '')::integer, 0);
      if v_row_number > 0 and jsonb_typeof(o.immutable_plan -> 'rows') = 'array'
         and (v_row_number - 1) < jsonb_array_length(o.immutable_plan -> 'rows') then
        v_row_key := (o.immutable_plan -> 'rows' -> (v_row_number - 1) ->> 'sheet_id') || ':' ||
                     (o.immutable_plan -> 'rows' -> (v_row_number - 1) ->> 'row_index');
      end if;
      select coalesce(array_agg(value), array[]::text[])
        into v_override_keys
        from jsonb_array_elements_text(coalesce(o.immutable_plan -> 'duplicate_overrides', '[]'::jsonb)) as value;

      v_norm_phone := public.paper_scan_normalize_phone_for_guard(
        coalesce(s.member_payload ->> 'Phone Number', s.member_payload ->> 'phone_number'));
      v_norm_name := public.paper_scan_normalize_name_for_guard(
        coalesce(s.member_payload ->> 'Full Name', s.member_payload ->> 'full_name'));

      if not (v_row_key is not null and v_row_key = any(v_override_keys))
         and nullif(v_norm_phone, '') is not null
         and nullif(v_norm_name, '') is not null then
        execute format(
          'select id, %I, %I from public.%I
            where workspace_owner_id = $1
              and public.paper_scan_normalize_phone_for_guard(%I) = $2
              and public.paper_scan_normalize_name_for_guard(%I) = $3%s
            limit 1',
          'Full Name', 'Phone Number', v_table,
          'Phone Number', 'Full Name',
          case when v_has_deleted then ' and deleted_at is null' else '' end
        ) into v_candidate_id, v_candidate_name, v_candidate_phone
        using o.owner_id, v_norm_phone, v_norm_name;

        if v_candidate_id is not null then
          update public.paper_scan_save_steps set state = 'failed',
            result = jsonb_build_object(
              'success', false,
              'blocked_duplicate', true,
              'duplicate_candidate', jsonb_build_object(
                'id', v_candidate_id,
                'full_name', v_candidate_name,
                'phone_number', v_candidate_phone
              ),
              'error', 'Possible existing member found before save; review before creating a new record.'
            ),
            updated_at = now()
          where id = s.id and operation_id = o.id;
          update public.paper_scan_save_operations set status = 'failed', updated_at = now() where id = o.id;
          return jsonb_build_object(
            'success', false,
            'blocked_duplicate', true,
            'duplicate_candidate', jsonb_build_object(
              'id', v_candidate_id,
              'full_name', v_candidate_name,
              'phone_number', v_candidate_phone
            ),
            'error_message', 'Possible existing member found before save; review before creating a new record.'
          );
        end if;
      end if;

      if exists (
        select 1 from public.workspace_member_provenance_exclusions where member_id = s.member_id
      ) then
        raise exception 'Member id % is excluded from workspace provenance', s.member_id;
      end if;
      if exists (
        select 1 from public.workspace_member_codes where member_id = s.member_id and workspace_owner_id <> o.owner_id
      ) then
        raise exception 'Member id % belongs to another workspace', s.member_id;
      end if;
      v_sql := format('insert into public.%I (id, user_id, workspace_owner_id, %I, %I, %I, %I) values ($1,$2,$2,$3,$4,$5,$6) on conflict (id) do nothing',
        v_table, 'Full Name', 'Gender', 'Phone Number', 'Current Level');
      execute v_sql using s.member_id, o.owner_id, coalesce(s.member_payload ->> 'Full Name', s.member_payload ->> 'full_name'),
        coalesce(s.member_payload ->> 'Gender', s.member_payload ->> 'gender'),
        coalesce(s.member_payload ->> 'Phone Number', s.member_payload ->> 'phone_number'),
        coalesce(s.member_payload ->> 'Current Level', s.member_payload ->> 'current_level');
      get diagnostics v_count = row_count;
      if v_count = 0 then
        declare
          v_existing_owner uuid;
          v_existing_deleted boolean := false;
        begin
          execute format(
            'select workspace_owner_id%s from public.%I where id = $1',
            case when v_has_deleted then ', deleted_at is not null' else '' end,
            v_table
          ) into v_existing_owner, v_existing_deleted using s.member_id;

          if v_existing_owner is null or v_existing_owner <> o.owner_id or coalesce(v_existing_deleted, false) then
            raise exception 'Member id % is not owned by the authorized workspace', s.member_id;
          end if;
        end;
      end if;
      perform public.ensure_workspace_member_code(o.owner_id, jsonb_build_object('id', s.member_id));
    elsif s.kind = 'profile' then
      if jsonb_typeof(s.profile_payload) <> 'object' or s.profile_payload = '{}'::jsonb then raise exception 'No approved profile fields'; end if;
      v_sql := format('update public.%I set ', v_table);
      if s.profile_payload ? 'full_name' or s.profile_payload ? 'Full Name' then
        v_sql := v_sql || format('%I = $1, ', 'Full Name');
      else
        v_sql := v_sql || format('%I = %I, ', 'Full Name', 'Full Name');
      end if;
      if s.profile_payload ? 'phone_number' or s.profile_payload ? 'Phone Number' then
        v_sql := v_sql || format('%I = $2, ', 'Phone Number');
      else
        v_sql := v_sql || format('%I = %I, ', 'Phone Number', 'Phone Number');
      end if;
      if s.profile_payload ? 'gender' or s.profile_payload ? 'Gender' then
        v_sql := v_sql || format('%I = $3, ', 'Gender');
      else
        v_sql := v_sql || format('%I = %I, ', 'Gender', 'Gender');
      end if;
      if s.profile_payload ? 'current_level' or s.profile_payload ? 'Current Level' then
        v_sql := v_sql || format('%I = $4, ', 'Current Level');
      else
        v_sql := v_sql || format('%I = %I, ', 'Current Level', 'Current Level');
      end if;
      v_sql := regexp_replace(v_sql, ', $', '') || format(' where id=$5 and workspace_owner_id = $6%s', case when v_has_deleted then ' and deleted_at is null' else '' end);
      execute v_sql using
        coalesce(s.profile_payload ->> 'Full Name', s.profile_payload ->> 'full_name'),
        coalesce(s.profile_payload ->> 'Phone Number', s.profile_payload ->> 'phone_number'),
        coalesce(s.profile_payload ->> 'Gender', s.profile_payload ->> 'gender'),
        coalesce(s.profile_payload ->> 'Current Level', s.profile_payload ->> 'current_level'),
        s.member_id, o.owner_id;
      get diagnostics v_count = row_count;
      if v_count <> 1 then raise exception 'Member is not present in the trusted month'; end if;
    else
      if s.attendance_date is null or extract(isodow from s.attendance_date) <> 7 or s.attendance_status not in ('Present', 'Absent') then
        raise exception 'Invalid attendance step';
      end if;
      v_column := public.ensure_workspace_attendance_column(o.owner_id, s.month_start, s.attendance_date);
      execute format('update public.%I set %I=$1 where id=$2 and workspace_owner_id = $3%s', v_table, v_column,
        case when v_has_deleted then ' and deleted_at is null' else '' end) using s.attendance_status, s.member_id, o.owner_id;
      get diagnostics v_count = row_count;
      if v_count <> 1 then raise exception 'Member is not present in the trusted month'; end if;
    end if;
    update public.paper_scan_save_steps set state = 'succeeded', result = jsonb_build_object('success', true, 'step_id', s.id, 'affected', v_count), updated_at = now() where id = s.id;
    update public.paper_scan_save_operations set status = case when not exists(
      select 1 from public.paper_scan_save_steps where operation_id = o.id and state <> 'succeeded'
    ) then 'complete' else 'running' end, updated_at = now() where id = o.id;
    return jsonb_build_object('success', true, 'step_id', s.id, 'affected', v_count);
  exception when others then
    if v_authorized then
      update public.paper_scan_save_steps set state = 'failed', result = jsonb_build_object('success', false, 'error', sqlerrm), updated_at = now()
      where id = s.id and operation_id = o.id;
      update public.paper_scan_save_operations set status = 'failed', updated_at = now() where id = o.id;
    end if;
    return jsonb_build_object('success', false, 'step_id', p_step_id, 'error_message', sqlerrm);
  end;
end;
$$;
revoke all on function public.paper_scan_execute_save_step(uuid, uuid) from public, anon;
grant execute on function public.paper_scan_execute_save_step(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';;
