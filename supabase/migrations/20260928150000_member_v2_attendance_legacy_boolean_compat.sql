-- Keep the canonical Member V2 attendance contract working on month tables
-- whose pre-existing Sunday columns are boolean instead of text.
create or replace function public.save_member_v2_attendance(
  p_owner_id uuid, p_member_id uuid, p_table_name text, p_attendance_date date,
  p_attendance_status text, p_attendance_id uuid, p_base_server_revision bigint,
  p_request_id text, p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_table text;
  v_column text;
  v_column_type text;
  v_month_name text;
  v_operation text := case when p_attendance_status is null then 'clear_member_v2_attendance' else 'set_member_v2_attendance' end;
  v_expected_fingerprint text;
  v_reservation jsonb;
  v_latest record;
  v_raw text;
  v_member_rows integer;
  v_current_status text;
  v_revision bigint;
  v_attendance_id uuid;
  v_response jsonb;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_owner_id is null or p_member_id is null or p_attendance_date is null
     or nullif(btrim(p_request_id), '') is null
     or p_attendance_date < date '1900-01-01'
     or extract(dow from p_attendance_date) <> 0 then
    raise exception 'Invalid Member V2 attendance target' using errcode = '22023';
  end if;
  if p_attendance_status is not null and p_attendance_status not in ('Present', 'Absent') then
    raise exception 'Attendance status must be Present, Absent, or Clear' using errcode = '22023';
  end if;

  v_month_name := (array[
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ])[extract(month from p_attendance_date)::integer] || '_' || extract(year from p_attendance_date)::integer::text;
  if p_table_name is distinct from v_month_name then
    raise exception 'Attendance date does not match the requested workspace month' using errcode = '22023';
  end if;
  v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, p_table_name);
  if v_table is distinct from p_table_name then
    raise exception 'Attendance month is not registered to this workspace' using errcode = '42501';
  end if;
  v_column := 'attendance_' || to_char(p_attendance_date, 'YYYY_MM_DD');
  if not public.month_table_has_column(v_table, v_column) then
    raise exception 'Attendance Sunday column is not available in the workspace month' using errcode = '22023';
  end if;
  select data_type into v_column_type
  from information_schema.columns
  where table_schema = 'public' and table_name = v_table and column_name = v_column;
  if public.member_v2_member_payload(v_table, p_owner_id, p_member_id, false) is null then
    raise exception 'Member is unavailable for attendance' using errcode = '42501';
  end if;

  perform public.member_v2_bootstrap_attendance_row(p_owner_id, v_table, p_member_id, p_attendance_date);
  v_expected_fingerprint := public.member_v2_attendance_fingerprint(
    v_operation, p_owner_id, p_member_id, v_table, p_attendance_date,
    p_attendance_status, p_base_server_revision
  );
  if p_payload_fingerprint is distinct from v_expected_fingerprint then
    raise exception 'Attendance payload fingerprint does not match' using errcode = '22023';
  end if;
  v_reservation := public.member_v2_reserve_mutation(
    p_request_id, p_owner_id, v_table, p_member_id, v_operation, p_payload_fingerprint
  );
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then
    return v_reservation -> 'response';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'member_v2_attendance:' || p_owner_id::text || ':' || v_table || ':' ||
      p_member_id::text || ':' || p_attendance_date::text,
    0
  ));
  select server_revision, attendance_id, attendance_status, is_deleted
    into v_latest
  from public.member_v2_change_events
  where owner_id = p_owner_id and table_name = v_table and member_id = p_member_id
    and attendance_date = p_attendance_date
  order by server_revision desc limit 1 for update;
  if found and p_base_server_revision is distinct from v_latest.server_revision then
    v_response := jsonb_build_object(
      'status', 'CONFLICT', 'server_revision', v_latest.server_revision,
      'attendance', jsonb_build_object(
        'attendance_id', v_latest.attendance_id::text,
        'attendance_date', p_attendance_date::text,
        'status', v_latest.attendance_status,
        'is_deleted', v_latest.is_deleted,
        'table_name', v_table
      )
    );
    perform public.member_v2_finish_mutation(p_request_id, 'CONFLICT', v_response);
    return v_response;
  elsif not found and p_base_server_revision is not null then
    v_response := jsonb_build_object('status', 'CONFLICT', 'server_revision', null, 'attendance', null);
    perform public.member_v2_finish_mutation(p_request_id, 'CONFLICT', v_response);
    return v_response;
  end if;

  execute format(
    'select %I::text from public.%I where id = $1 and workspace_owner_id = $2 for update',
    v_column, v_table
  ) into v_raw using p_member_id, p_owner_id;
  get diagnostics v_member_rows = row_count;
  if v_member_rows <> 1 then raise exception 'Member is unavailable for attendance' using errcode = '42501'; end if;
  v_current_status := public.member_v2_normalize_attendance_status(v_raw);
  if v_current_status is distinct from p_attendance_status then
    perform set_config('datser.member_v2.attendance_request_id', p_request_id, true);
    perform set_config('datser.member_v2.attendance_operation', v_operation, true);
    perform set_config('datser.member_v2.attendance_id', coalesce(p_attendance_id::text, ''), true);
    if v_column_type = 'boolean' then
      execute format(
        'update public.%I set %I = case when $1 is null then null else $1 = ''Present'' end where id = $2 and workspace_owner_id = $3',
        v_table, v_column
      ) using p_attendance_status, p_member_id, p_owner_id;
    else
      execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_table, v_column)
        using p_attendance_status, p_member_id, p_owner_id;
    end if;
  end if;

  select server_revision, attendance_id, attendance_status, is_deleted
    into v_latest
  from public.member_v2_change_events
  where request_id = p_request_id and owner_id = p_owner_id
    and table_name = v_table and member_id = p_member_id and attendance_date = p_attendance_date
  order by server_revision desc limit 1;
  if found then
    v_revision := v_latest.server_revision;
    v_attendance_id := v_latest.attendance_id;
  else
    select server_revision, attendance_id, attendance_status, is_deleted
      into v_latest
    from public.member_v2_change_events
    where owner_id = p_owner_id and table_name = v_table and member_id = p_member_id
      and attendance_date = p_attendance_date
    order by server_revision desc limit 1;
    v_revision := v_latest.server_revision;
    v_attendance_id := coalesce(v_latest.attendance_id, p_attendance_id);
  end if;
  if v_revision is null then
    v_revision := public.member_v2_record_attendance_change(
      p_owner_id, v_table, p_member_id, p_attendance_date, p_attendance_status,
      p_attendance_status is null, v_operation, p_request_id, auth.uid(), p_attendance_id
    );
    select attendance_id into v_attendance_id
    from public.member_v2_change_events
    where owner_id = p_owner_id and table_name = v_table and member_id = p_member_id
      and attendance_date = p_attendance_date and server_revision = v_revision;
  end if;

  v_response := jsonb_build_object(
    'status', 'SUCCESS', 'request_id', p_request_id, 'server_revision', v_revision,
    'attendance', jsonb_build_object(
      'attendance_id', v_attendance_id::text,
      'attendance_date', p_attendance_date::text,
      'status', p_attendance_status,
      'is_deleted', p_attendance_status is null,
      'table_name', v_table
    )
  );
  perform public.member_v2_finish_mutation(p_request_id, 'SUCCESS', v_response);
  return v_response;
end;
$$;

notify pgrst, 'reload schema';
