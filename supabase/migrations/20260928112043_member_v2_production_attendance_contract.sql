-- Production Member V2 attendance projection over DatSer's canonical monthly
-- attendance_YYYY_MM_DD text columns. Event rows are a change feed only; the
-- monthly member row remains the authoritative stored value.

alter table public.member_v2_change_events
  add column if not exists attendance_date date,
  add column if not exists attendance_id uuid,
  add column if not exists attendance_status text;

alter table public.member_v2_change_events
  drop constraint if exists member_v2_change_events_attendance_shape_check;
alter table public.member_v2_change_events
  add constraint member_v2_change_events_attendance_shape_check check (
    (attendance_date is null and attendance_id is null and attendance_status is null)
    or (
      attendance_date is not null
      and attendance_id is not null
      and ((is_deleted and attendance_status is null)
        or (not is_deleted and attendance_status in ('Present', 'Absent')))
    )
  );

alter table public.member_v2_mutations
  drop constraint if exists member_v2_mutations_operation_name_check;
alter table public.member_v2_mutations
  add constraint member_v2_mutations_operation_name_check check (
    operation_name in (
      'create_member_v2', 'update_member_v2', 'delete_member_v2',
      'set_member_v2_attendance', 'clear_member_v2_attendance'
    )
  );

create index if not exists member_v2_attendance_events_owner_revision_idx
  on public.member_v2_change_events(owner_id, server_revision)
  where attendance_date is not null;

create index if not exists member_v2_attendance_events_owner_member_date_revision_idx
  on public.member_v2_change_events(owner_id, table_name, member_id, attendance_date, server_revision desc)
  where attendance_date is not null;

create or replace function public.member_v2_normalize_attendance_status(p_value text)
returns text
language sql immutable set search_path = pg_catalog as $$
  select case lower(btrim(p_value))
    when 'present' then 'Present'
    when 'true' then 'Present'
    when 't' then 'Present'
    when '1' then 'Present'
    when 'absent' then 'Absent'
    when 'false' then 'Absent'
    when 'f' then 'Absent'
    when '0' then 'Absent'
    else null
  end;
$$;

create or replace function public.member_v2_record_attendance_change(
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid,
  p_attendance_date date,
  p_attendance_status text,
  p_is_deleted boolean,
  p_operation_name text,
  p_request_id text default null,
  p_actor_id uuid default null,
  p_attendance_id uuid default null
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_revision bigint;
  v_existing record;
  v_attendance_id uuid;
begin
  if p_attendance_status is not null and p_attendance_status not in ('Present', 'Absent') then
    raise exception 'Invalid canonical attendance status' using errcode = '22023';
  end if;
  if p_is_deleted is distinct from (p_attendance_status is null) then
    raise exception 'Attendance clear state does not match its status' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'member_v2_attendance:' || p_owner_id::text || ':' || p_table_name || ':' ||
      p_member_id::text || ':' || p_attendance_date::text,
    0
  ));

  select server_revision, attendance_id, attendance_status, is_deleted
    into v_existing
  from public.member_v2_change_events
  where owner_id = p_owner_id
    and table_name = p_table_name
    and member_id = p_member_id
    and attendance_date = p_attendance_date
  order by server_revision desc
  limit 1
  for update;

  if found
     and v_existing.attendance_status is not distinct from p_attendance_status
     and v_existing.is_deleted = p_is_deleted then
    return v_existing.server_revision;
  end if;

  v_attendance_id := coalesce(
    p_attendance_id,
    v_existing.attendance_id,
    md5(p_owner_id::text || ':' || p_table_name || ':' || p_member_id::text || ':' || p_attendance_date::text)::uuid
  );

  insert into public.member_v2_change_events(
    owner_id, table_name, member_id, is_deleted, operation_name,
    request_id, actor_id, member_payload, attendance_date, attendance_id, attendance_status
  ) values (
    p_owner_id, p_table_name, p_member_id, p_is_deleted, p_operation_name,
    p_request_id, p_actor_id, '{}'::jsonb, p_attendance_date, v_attendance_id, p_attendance_status
  ) returning server_revision into v_revision;

  -- Reuse the existing metadata-only wake table; one logical attendance event
  -- creates exactly one common event revision and one wake signal.
  insert into public.member_v2_realtime_signals(owner_id, latest_server_revision)
  values (p_owner_id, v_revision);

  return v_revision;
end;
$$;

create or replace function public.member_v2_capture_month_attendance()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_owner_id uuid;
  v_member_id uuid;
  v_column text;
  v_parts text[];
  v_date date;
  v_month_name text;
  v_old_status text;
  v_new_status text;
  v_request_id text;
  v_operation text;
  v_attendance_id uuid;
begin
  begin
    v_owner_id := nullif(coalesce(v_new ->> 'workspace_owner_id', v_old ->> 'workspace_owner_id'), '')::uuid;
    v_member_id := nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid;
  exception when invalid_text_representation then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end;
  if v_owner_id is null or v_member_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  for v_column in
    select key
    from jsonb_object_keys(case when tg_op = 'INSERT' then v_new else v_old end) as keys(key)
    where key ~ '^attendance_[0-9]{4}_[0-9]{2}_[0-9]{2}$'
  loop
    v_parts := regexp_match(v_column, '^attendance_([0-9]{4})_([0-9]{2})_([0-9]{2})$');
    begin
      v_date := make_date(v_parts[1]::integer, v_parts[2]::integer, v_parts[3]::integer);
    exception when datetime_field_overflow or invalid_text_representation then
      continue;
    end;
    if extract(dow from v_date) <> 0 then continue; end if;
    v_month_name := (array[
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ])[extract(month from v_date)::integer] || '_' || extract(year from v_date)::integer::text;
    if v_month_name <> tg_table_name then continue; end if;

    v_old_status := public.member_v2_normalize_attendance_status(v_old ->> v_column);
    v_new_status := public.member_v2_normalize_attendance_status(v_new ->> v_column);
    if tg_op = 'UPDATE' and v_old_status is not distinct from v_new_status then continue; end if;
    if tg_op = 'INSERT' and v_new_status is null then continue; end if;
    if tg_op = 'DELETE' and v_old_status is null then continue; end if;

    v_request_id := nullif(current_setting('datser.member_v2.attendance_request_id', true), '');
    v_operation := nullif(current_setting('datser.member_v2.attendance_operation', true), '');
    v_operation := coalesce(v_operation, case when v_new_status is null then 'legacy_attendance_clear' else 'legacy_attendance_write' end);
    begin
      v_attendance_id := nullif(current_setting('datser.member_v2.attendance_id', true), '')::uuid;
    exception when invalid_text_representation then
      v_attendance_id := null;
    end;

    perform public.member_v2_record_attendance_change(
      v_owner_id,
      tg_table_name,
      v_member_id,
      v_date,
      v_new_status,
      v_new_status is null,
      v_operation,
      v_request_id,
      auth.uid(),
      v_attendance_id
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.member_v2_install_month_attendance_capture_trigger(p_table_name text)
returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_trigger_name text;
begin
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'
     or to_regclass(format('public.%I', p_table_name)) is null
     or not public.month_table_has_column(p_table_name, 'workspace_owner_id')
     or not public.month_table_has_column(p_table_name, 'id') then
    raise exception 'Invalid trusted month table for attendance capture' using errcode = '22023';
  end if;
  v_trigger_name := left('member_v2_attendance_' || lower(p_table_name), 63);
  execute format('drop trigger if exists %I on public.%I', v_trigger_name, p_table_name);
  execute format(
    'create trigger %I after insert or update or delete on public.%I for each row execute function public.member_v2_capture_month_attendance()',
    v_trigger_name, p_table_name
  );
end;
$$;

create or replace function public.member_v2_install_attendance_capture_from_registry()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.member_v2_install_month_attendance_capture_trigger(new.table_name);
  return new;
end;
$$;

drop trigger if exists member_v2_install_attendance_capture_from_registry on public.workspace_month_tables;
create trigger member_v2_install_attendance_capture_from_registry
after insert or update of table_name on public.workspace_month_tables
for each row execute function public.member_v2_install_attendance_capture_from_registry();

do $$
declare v_table text;
begin
  for v_table in
    select distinct table_name from public.workspace_month_tables order by table_name
  loop
    perform public.member_v2_install_month_attendance_capture_trigger(v_table);
  end loop;
end;
$$;

create or replace function public.member_v2_bootstrap_attendance_row(
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid,
  p_attendance_date date
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_column text := 'attendance_' || to_char(p_attendance_date, 'YYYY_MM_DD');
  v_raw text;
  v_status text;
begin
  if not public.month_table_has_column(p_table_name, v_column) then
    return null;
  end if;
  execute format(
    'select %I::text from public.%I where id = $1 and workspace_owner_id = $2',
    v_column, p_table_name
  ) into v_raw using p_member_id, p_owner_id;
  if not found then return null; end if;
  v_status := public.member_v2_normalize_attendance_status(v_raw);
  if v_status is null then return null; end if;
  return public.member_v2_record_attendance_change(
    p_owner_id, p_table_name, p_member_id, p_attendance_date, v_status, false,
    'attendance_bootstrap', null, auth.uid(), null
  );
end;
$$;

create or replace function public.member_v2_bootstrap_attendance_workspace(p_owner_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_table text;
  v_column text;
  v_parts text[];
  v_date date;
  v_month_name text;
  v_row record;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  for v_table in
    select distinct table_name from public.workspace_month_tables where owner_id = p_owner_id order by table_name
  loop
    v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, v_table);
    for v_column in
      select attribute.attname
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass(format('public.%I', v_table))
        and attribute.attnum > 0 and not attribute.attisdropped
        and attribute.attname ~ '^attendance_[0-9]{4}_[0-9]{2}_[0-9]{2}$'
      order by attribute.attnum
    loop
      v_parts := regexp_match(v_column, '^attendance_([0-9]{4})_([0-9]{2})_([0-9]{2})$');
      begin
        v_date := make_date(v_parts[1]::integer, v_parts[2]::integer, v_parts[3]::integer);
      exception when datetime_field_overflow or invalid_text_representation then
        continue;
      end;
      if extract(dow from v_date) <> 0 then continue; end if;
      v_month_name := (array[
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ])[extract(month from v_date)::integer] || '_' || extract(year from v_date)::integer::text;
      if v_month_name <> v_table then continue; end if;
      for v_row in execute format(
        'select id, %I::text as attendance_value from public.%I where workspace_owner_id = $1 order by id',
        v_column, v_table
      ) using p_owner_id loop
        if public.member_v2_normalize_attendance_status(v_row.attendance_value) is not null then
          perform public.member_v2_bootstrap_attendance_row(p_owner_id, v_table, v_row.id, v_date);
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function public.member_v2_attendance_fingerprint(
  p_operation text, p_owner_id uuid, p_member_id uuid, p_table_name text,
  p_attendance_date date, p_attendance_status text, p_base_server_revision bigint
) returns text
language sql stable set search_path = pg_catalog, public, extensions as $$
  select encode(extensions.digest(public.member_v2_canonical_json(jsonb_build_object(
    'attendance_date', p_attendance_date::text,
    'attendance_status', p_attendance_status,
    'base_server_revision', p_base_server_revision,
    'member_id', p_member_id::text,
    'operation', p_operation,
    'owner_id', p_owner_id::text,
    'table_name', p_table_name
  )), 'sha256'), 'hex');
$$;

create or replace function public.save_member_v2_attendance(
  p_owner_id uuid, p_member_id uuid, p_table_name text, p_attendance_date date,
  p_attendance_status text, p_attendance_id uuid, p_base_server_revision bigint,
  p_request_id text, p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_table text;
  v_column text;
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
  if v_raw is distinct from p_attendance_status then
    perform set_config('datser.member_v2.attendance_request_id', p_request_id, true);
    perform set_config('datser.member_v2.attendance_operation', v_operation, true);
    perform set_config('datser.member_v2.attendance_id', coalesce(p_attendance_id::text, ''), true);
    execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_table, v_column)
      using p_attendance_status, p_member_id, p_owner_id;
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

create or replace function public.pull_member_v2_attendance_changes_v2(
  p_owner_id uuid,
  p_after_server_revision bigint default null,
  p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_changes jsonb;
  v_next bigint;
  v_more boolean;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_limit is null or p_limit < 1 or p_limit > 500
     or (p_after_server_revision is not null and p_after_server_revision < 0) then
    raise exception 'Invalid attendance pull cursor or limit' using errcode = '22023';
  end if;
  if p_after_server_revision is null then
    perform public.member_v2_bootstrap_attendance_workspace(p_owner_id);
  end if;
  with rows as (
    select server_revision, table_name, member_id, attendance_date, attendance_id,
      attendance_status, is_deleted, operation_name, created_at
    from public.member_v2_change_events
    where owner_id = p_owner_id and attendance_date is not null
      and server_revision > coalesce(p_after_server_revision, 0)
    order by server_revision
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'server_revision', server_revision,
    'table_name', table_name,
    'member_id', member_id,
    'attendance_date', attendance_date::text,
    'attendance_id', attendance_id::text,
    'status', attendance_status,
    'is_deleted', is_deleted,
    'operation', operation_name,
    'changed_at', created_at
  ) order by server_revision), '[]'::jsonb), max(server_revision)
  into v_changes, v_next
  from rows;

  select exists (
    select 1 from public.member_v2_change_events
    where owner_id = p_owner_id and attendance_date is not null
      and server_revision > coalesce(v_next, p_after_server_revision, 0)
  ) into v_more;

  return jsonb_build_object('status', 'SUCCESS', 'changes', v_changes, 'next_cursor', v_next, 'has_more', v_more);
end;
$$;

-- The member pull uses the same global revision sequence but returns only member
-- profile changes; attendance changes have their own typed authoritative pull.
create or replace function public.pull_workspace_member_changes_v2(
  p_owner_id uuid,
  p_after_server_revision bigint default null,
  p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_changes jsonb;
  v_next_revision bigint;
  v_has_more boolean;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Pull limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_after_server_revision is null then perform public.member_v2_bootstrap_workspace(p_owner_id); end if;
  with rows as (
    select server_revision, table_name, member_id, is_deleted, member_payload, operation_name, created_at
    from public.member_v2_change_events
    where owner_id = p_owner_id and attendance_date is null
      and server_revision > coalesce(p_after_server_revision, 0)
    order by server_revision, member_id
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'server_revision', server_revision, 'table_name', table_name, 'member_id', member_id,
    'is_deleted', is_deleted, 'member', member_payload, 'operation', operation_name, 'changed_at', created_at
  ) order by server_revision, member_id), '[]'::jsonb), max(server_revision)
  into v_changes, v_next_revision from rows;
  select exists (
    select 1 from public.member_v2_change_events
    where owner_id = p_owner_id and attendance_date is null
      and server_revision > coalesce(v_next_revision, p_after_server_revision, 0)
  ) into v_has_more;
  return jsonb_build_object(
    'status', 'SUCCESS', 'changes', v_changes, 'next_cursor', v_next_revision, 'has_more', v_has_more
  );
end;
$$;

revoke all on function public.member_v2_normalize_attendance_status(text) from public, anon, authenticated;
revoke all on function public.member_v2_record_attendance_change(uuid,text,uuid,date,text,boolean,text,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.member_v2_capture_month_attendance() from public, anon, authenticated;
revoke all on function public.member_v2_install_month_attendance_capture_trigger(text) from public, anon, authenticated;
revoke all on function public.member_v2_install_attendance_capture_from_registry() from public, anon, authenticated;
revoke all on function public.member_v2_bootstrap_attendance_row(uuid,text,uuid,date) from public, anon, authenticated;
revoke all on function public.member_v2_bootstrap_attendance_workspace(uuid) from public, anon, authenticated;
revoke all on function public.member_v2_attendance_fingerprint(text,uuid,uuid,text,date,text,bigint) from public, anon, authenticated;
revoke all on function public.save_member_v2_attendance(uuid,uuid,text,date,text,uuid,bigint,text,text) from public, anon;
revoke all on function public.pull_member_v2_attendance_changes_v2(uuid,bigint,integer) from public, anon;
revoke all on function public.pull_workspace_member_changes_v2(uuid,bigint,integer) from public, anon;
grant execute on function public.save_member_v2_attendance(uuid,uuid,text,date,text,uuid,bigint,text,text) to authenticated;
grant execute on function public.pull_member_v2_attendance_changes_v2(uuid,bigint,integer) to authenticated;
grant execute on function public.pull_workspace_member_changes_v2(uuid,bigint,integer) to authenticated;

notify pgrst, 'reload schema';
