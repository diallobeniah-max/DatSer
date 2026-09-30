-- Forward-only lock-order repair. No historical migration is changed.
-- All writers take the owner feed lock before reservations, code/member/head,
-- cell, or physical row locks. BEFORE STATEMENT coordinates direct legacy SQL;
-- BEFORE ROW only verifies coordination and never waits for a broad lock.
-- Multiple owners must be acquired in ascending feed-key order; reject a
-- reverse-order transaction with 40001 instead of introducing an owner cycle.
create or replace function public.member_v2_owner_lock_held(p_owner_id uuid)
returns boolean language sql volatile security definer
set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1 from pg_catalog.pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and mode = 'ExclusiveLock' and objsubid = 1
      and database = (select oid from pg_catalog.pg_database where datname = current_database())
      and classid::bigint = ((hashtextextended('datser.member_v2.change-feed:' || p_owner_id::text, 0) >> 32) & 4294967295)
      and objid::bigint = (hashtextextended('datser.member_v2.change-feed:' || p_owner_id::text, 0) & 4294967295)
  );
$$;

create or replace function public.member_v2_lock_change_event_order(p_owner_id uuid)
returns void language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_key bigint := hashtextextended('datser.member_v2.change-feed:' || p_owner_id::text, 0);
  v_owners uuid[] := coalesce(nullif(current_setting('datser.member_v2.locked_owners', true), '')::uuid[], array[]::uuid[]);
  v_owner uuid;
begin
  if p_owner_id is null then raise exception 'Workspace owner is required' using errcode = '22023'; end if;
  if public.member_v2_owner_lock_held(p_owner_id) then return; end if;
  foreach v_owner in array v_owners loop
    if public.member_v2_owner_lock_held(v_owner)
       and hashtextextended('datser.member_v2.change-feed:' || v_owner::text, 0) > v_key then
      raise exception 'Acquire workspace feed locks in ascending order; retry the transaction' using errcode = '40001';
    end if;
  end loop;
  perform pg_advisory_xact_lock(v_key);
  perform set_config('datser.member_v2.locked_owners', array_append(v_owners, p_owner_id)::text, true);
end;
$$;

create or replace function public.member_v2_begin_workspace_write(p_owner_id uuid)
returns void language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  perform public.member_v2_lock_change_event_order(p_owner_id);
  perform set_config('datser.member_v2.write_owner', p_owner_id::text, true);
end;
$$;

create or replace function public.member_v2_lock_month_statement()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_owner uuid;
  v_scoped_owner uuid := nullif(current_setting('datser.member_v2.write_owner', true), '')::uuid;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or (auth.uid() is null and current_setting('role', true) in ('anon', 'authenticated')) then
    raise exception 'Permanent workspace authentication is required for legacy writes' using errcode = '42501';
  end if;
  -- A trusted writer already bound its authorized owner before narrower locks.
  -- The row guard verifies actual OLD/NEW owners; this setting is not authority.
  if v_scoped_owner is not null and public.member_v2_owner_lock_held(v_scoped_owner) then return null; end if;
  -- Direct legacy SQL has no row values at statement start. Lock the registered
  -- accessible owner set, deterministically, before the executor locks any row.
  -- Privileged maintenance without a JWT coordinates all registered owners.
  for v_owner in
    select owner_id from (
      select distinct owner_id from public.workspace_month_tables
      where table_name = tg_table_name
        and (auth.uid() is null or public.has_permanent_workspace_access(owner_id))
      union select auth.uid() where auth.uid() is not null
    ) owners
    order by hashtextextended('datser.member_v2.change-feed:' || owner_id::text, 0), owner_id
  loop
    perform public.member_v2_lock_change_event_order(v_owner);
  end loop;
  return null;
end;
$$;

create or replace function public.member_v2_assert_month_owner_lock()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.workspace_owner_id is not null
     and not public.member_v2_owner_lock_held(old.workspace_owner_id) then
    raise exception 'Legacy row owner was not coordinated before mutation' using errcode = '40001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.workspace_owner_id is not null
     and not public.member_v2_owner_lock_held(new.workspace_owner_id) then
    raise exception 'Legacy row owner was not coordinated before mutation' using errcode = '40001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.member_v2_install_month_lock_triggers(p_table_name text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'
     or to_regclass(format('public.%I', p_table_name)) is null
     or not public.month_table_has_column(p_table_name, 'workspace_owner_id') then
    raise exception 'Invalid trusted month table for lock coordination' using errcode = '22023';
  end if;
  execute format('drop trigger if exists member_v2_00_statement_lock on public.%I', p_table_name);
  execute format('create trigger member_v2_00_statement_lock before insert or update or delete on public.%I for each statement execute function public.member_v2_lock_month_statement()', p_table_name);
  execute format('drop trigger if exists member_v2_01_row_lock_guard on public.%I', p_table_name);
  execute format('create trigger member_v2_01_row_lock_guard before insert or update or delete on public.%I for each row execute function public.member_v2_assert_month_owner_lock()', p_table_name);
end;
$$;

create or replace function public.member_v2_install_lock_from_registry()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.member_v2_install_month_lock_triggers(new.table_name);
  return new;
end;
$$;
revoke all on function public.member_v2_owner_lock_held(uuid) from public, anon, authenticated;
revoke all on function public.member_v2_lock_change_event_order(uuid) from public, anon, authenticated;
revoke all on function public.member_v2_begin_workspace_write(uuid) from public, anon, authenticated;
revoke all on function public.member_v2_lock_month_statement() from public, anon, authenticated;
revoke all on function public.member_v2_assert_month_owner_lock() from public, anon, authenticated;
revoke all on function public.member_v2_install_month_lock_triggers(text) from public, anon, authenticated;
revoke all on function public.member_v2_install_lock_from_registry() from public, anon, authenticated;

drop trigger if exists member_v2_install_lock_from_registry on public.workspace_month_tables;
create trigger member_v2_install_lock_from_registry after insert or update of table_name on public.workspace_month_tables
for each row execute function public.member_v2_install_lock_from_registry();
do $$
declare v_table text;
begin
  for v_table in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
      and public.month_table_has_column(c.relname, 'workspace_owner_id')
  loop perform public.member_v2_install_month_lock_triggers(v_table); end loop;
end;
$$;


-- Preserve the existing create_member_v2 contract from 20260913074014_rxdb_member_phase1_server_contract.sql; only move coordination ahead of narrower locks.
create or replace function public.create_member_v2(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_member jsonb,
  p_request_id text,
  p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_table text;
  v_payload jsonb;
  v_expected_fingerprint text;
  v_reservation jsonb;
  v_column text;
  v_column_type text;
  v_columns text := 'id, workspace_owner_id, user_id';
  v_values text := '$1, $2, $2';
  v_row jsonb;
  v_revision bigint;
  v_response jsonb;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_member_id is null then
    raise exception 'Client-generated member UUID is required' using errcode = '22023';
  end if;
  v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, p_table_name);
  if p_member ? 'id' and nullif(p_member ->> 'id', '')::uuid <> p_member_id then
    raise exception 'Payload member id does not match target member id' using errcode = '22023';
  end if;
  v_payload := public.member_v2_normalize_payload(v_table, p_member);
  if coalesce(nullif(btrim(coalesce(v_payload ->> 'Full Name', v_payload ->> 'full_name', v_payload ->> 'Name', v_payload ->> 'name', '')), ''), '') = '' then
    raise exception 'Member full name is required' using errcode = '22023';
  end if;
  v_expected_fingerprint := public.member_v2_fingerprint('create_member_v2', p_owner_id, v_table, p_member_id, null, v_payload);
  if lower(coalesce(p_payload_fingerprint, '')) <> v_expected_fingerprint then
    raise exception 'Payload fingerprint does not match the canonical member mutation' using errcode = '22023';
  end if;
  v_reservation := public.member_v2_reserve_mutation(p_request_id, p_owner_id, v_table, p_member_id, 'create_member_v2', v_expected_fingerprint);
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then
    return v_reservation -> 'response';
  end if;

  if exists (select 1 from public.member_v2_claims where member_id = p_member_id) then
    raise exception 'Client member UUID is already claimed' using errcode = '23505';
  end if;
  if exists (select 1 from public.member_v2_heads where member_id = p_member_id) then
    raise exception 'Client member UUID already exists in member history' using errcode = '23505';
  end if;

  for v_column, v_column_type in
    select attribute.attname, format_type(attribute.atttypid, attribute.atttypmod)
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = to_regclass(format('public.%I', v_table))
      and attribute.attnum > 0
      and not attribute.attisdropped
      and v_payload ? attribute.attname
    order by attribute.attnum
  loop
    v_columns := v_columns || ', ' || format('%I', v_column);
    v_values := v_values || format(', (($3 ->> %L)::%s)', v_column, v_column_type);
  end loop;

  perform set_config('datser.member_v2.skip_capture', 'on', true);
  execute format('insert into public.%I (%s) values (%s)', v_table, v_columns, v_values)
    using p_member_id, p_owner_id, v_payload;
  insert into public.member_v2_claims(member_id, owner_id, table_name)
  values (p_member_id, p_owner_id, v_table);
  perform public.ensure_workspace_member_code(p_owner_id, jsonb_build_object('id', p_member_id));
  v_row := public.member_v2_member_payload(v_table, p_owner_id, p_member_id, false);
  if v_row is null or nullif(v_row ->> 'member_code', '') is null then
    raise exception 'Member code allocation did not complete' using errcode = 'P0001';
  end if;
  v_revision := public.member_v2_record_change(p_owner_id, v_table, p_member_id, v_row, false, 'create_member_v2', p_request_id, v_actor);
  v_response := jsonb_build_object(
    'status', 'SUCCESS', 'request_id', p_request_id, 'member_id', p_member_id,
    'table_name', v_table, 'server_revision', v_revision, 'member', v_row
  );
  perform public.member_v2_finish_mutation(p_request_id, 'SUCCESS', v_response);
  return v_response;
end;
$$;


-- Preserve the existing update_member_v2 contract from 20260913074014_rxdb_member_phase1_server_contract.sql; only move coordination ahead of narrower locks.
create or replace function public.update_member_v2(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_updates jsonb,
  p_base_server_revision bigint,
  p_request_id text,
  p_payload_fingerprint text,
  p_identity jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_target jsonb;
  v_table text;
  v_updates jsonb;
  v_expected_fingerprint text;
  v_reservation jsonb;
  v_current_revision bigint;
  v_current_member jsonb;
  v_row jsonb;
  v_revision bigint;
  v_response jsonb;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_base_server_revision is null or p_base_server_revision < 1 then
    raise exception 'A positive base server revision is required' using errcode = '22023';
  end if;
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, p_identity);
  v_table := v_target ->> 'table_name';
  v_updates := public.member_v2_normalize_payload(v_table, p_updates);
  if v_updates = '{}'::jsonb then
    raise exception 'At least one supported profile field is required' using errcode = '22023';
  end if;
  v_expected_fingerprint := public.member_v2_fingerprint('update_member_v2', p_owner_id, v_table, p_member_id, p_base_server_revision, v_updates);
  if lower(coalesce(p_payload_fingerprint, '')) <> v_expected_fingerprint then
    raise exception 'Payload fingerprint does not match the canonical member mutation' using errcode = '22023';
  end if;
  v_reservation := public.member_v2_reserve_mutation(p_request_id, p_owner_id, v_table, p_member_id, 'update_member_v2', v_expected_fingerprint);
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then
    return v_reservation -> 'response';
  end if;

  v_current_revision := public.member_v2_bootstrap_head(p_owner_id, v_table, p_member_id);
  select member_payload into v_current_member
  from public.member_v2_heads
  where owner_id = p_owner_id and table_name = v_table and member_id = p_member_id
  for update;
  if v_current_revision <> p_base_server_revision then
    v_response := jsonb_build_object(
      'status', 'CONFLICT', 'request_id', p_request_id, 'member_id', p_member_id,
      'table_name', v_table, 'base_server_revision', p_base_server_revision,
      'server_revision', v_current_revision, 'member', v_current_member
    );
    perform public.member_v2_finish_mutation(p_request_id, 'CONFLICT', v_response);
    return v_response;
  end if;

  perform set_config('datser.member_v2.skip_capture', 'on', true);
  perform public.update_member_record(v_table, p_member_id, v_updates || jsonb_build_object('updated_at', to_jsonb(clock_timestamp())), p_owner_id);
  v_row := public.member_v2_member_payload(v_table, p_owner_id, p_member_id, false);
  if v_row is null then
    raise exception 'Member update verification failed' using errcode = '42501';
  end if;
  v_revision := public.member_v2_record_change(p_owner_id, v_table, p_member_id, v_row, false, 'update_member_v2', p_request_id, v_actor);
  v_response := jsonb_build_object(
    'status', 'SUCCESS', 'request_id', p_request_id, 'member_id', p_member_id,
    'table_name', v_table, 'base_server_revision', p_base_server_revision,
    'server_revision', v_revision, 'member', v_row
  );
  perform public.member_v2_finish_mutation(p_request_id, 'SUCCESS', v_response);
  return v_response;
end;
$$;


-- Preserve the existing delete_member_v2 contract from 20260926185422_member_v2_soft_delete_single_change.sql; only move coordination ahead of narrower locks.
create or replace function public.delete_member_v2(
  p_table_name text, p_owner_id uuid, p_member_id uuid,
  p_base_server_revision bigint, p_request_id text, p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid(); v_table text; v_head public.member_v2_heads%rowtype;
  v_row jsonb; v_deleted jsonb; v_revision bigint; v_expected text; v_reservation jsonb; v_response jsonb;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, p_table_name);
  if not public.month_table_has_column(v_table, 'deleted_at') then
    raise exception 'Trusted month does not support Member V2 soft delete' using errcode = '0A000';
  end if;
  if not exists (
    select 1 from public.member_v2_claims
    where member_id = p_member_id and owner_id = p_owner_id and table_name = v_table
  ) then
    raise exception 'Member V2 claim is unavailable for this trusted month' using errcode = '42501';
  end if;
  v_expected := public.member_v2_fingerprint('delete_member_v2', p_owner_id, v_table, p_member_id, p_base_server_revision, '{}'::jsonb);
  if p_payload_fingerprint is distinct from v_expected then raise exception 'Member delete payload fingerprint does not match' using errcode = '22023'; end if;
  v_reservation := public.member_v2_reserve_mutation(p_request_id, p_owner_id, v_table, p_member_id, 'delete_member_v2', p_payload_fingerprint);
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then return v_reservation -> 'response'; end if;
  perform pg_advisory_xact_lock(hashtextextended('member_v2:' || p_owner_id::text || ':' || v_table || ':' || p_member_id::text, 0));
  select * into v_head from public.member_v2_heads where owner_id = p_owner_id and table_name = v_table and member_id = p_member_id for update;
  if not found or v_head.is_deleted or p_base_server_revision is distinct from v_head.server_revision then
    v_response := jsonb_build_object('status', 'CONFLICT', 'server_revision', v_head.server_revision, 'member', v_head.member_payload, 'table_name', v_table);
    perform public.member_v2_finish_mutation(p_request_id, 'CONFLICT', v_response); return v_response;
  end if;
  execute format('select to_jsonb(m) from public.%I m where m.id = $1 and m.workspace_owner_id = $2 for update', v_table) into v_row using p_member_id, p_owner_id;
  if v_row is null or (v_row ->> 'deleted_at') is not null then raise exception 'Active member is unavailable in the trusted month' using errcode = '42501'; end if;

  perform set_config('datser.member_v2.skip_capture', 'on', true);
  if public.month_table_has_column(v_table, 'updated_at') then
    execute format('update public.%I set deleted_at = clock_timestamp(), updated_at = clock_timestamp() where id = $1 and workspace_owner_id = $2', v_table) using p_member_id, p_owner_id;
  else
    execute format('update public.%I set deleted_at = clock_timestamp() where id = $1 and workspace_owner_id = $2', v_table) using p_member_id, p_owner_id;
  end if;
  v_deleted := public.member_v2_member_payload(v_table, p_owner_id, p_member_id, true);
  v_revision := public.member_v2_record_change(p_owner_id, v_table, p_member_id, v_deleted, true, 'delete_member_v2', p_request_id, v_actor);
  v_response := jsonb_build_object('status', 'SUCCESS', 'server_revision', v_revision, 'member', v_deleted, 'table_name', v_table);
  perform public.member_v2_finish_mutation(p_request_id, 'SUCCESS', v_response); return v_response;
end;
$$;


-- Preserve the existing save_member_v2_attendance contract from 20260928150000_member_v2_attendance_legacy_boolean_compat.sql; only move coordination ahead of narrower locks.
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
  perform public.member_v2_begin_workspace_write(p_owner_id);
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


-- Preserve the existing create_workspace_month contract from 20260814122618_20260813170000_harden_paper_scan_final_save.sql; only move coordination ahead of narrower locks.
create or replace function public.create_workspace_month(
  p_owner_id uuid, p_year integer, p_month integer, p_source_month date,
  p_copy_mode text, p_member_ids uuid[] default array[]::uuid[]
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_target_month date;
  v_target text;
  v_source text;
  v_copied integer := 0;
  v_target_exists boolean;
  v_source_has_deleted boolean;
  v_copy_filter text;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  v_actor := public.require_permanent_workspace_actor(p_owner_id, true);
  if p_year not between 2000 and 2200 or p_month not between 1 and 12
     or p_copy_mode not in ('all', 'custom', 'empty') then
    raise exception 'Invalid logical month request' using errcode = '22023';
  end if;
  if p_copy_mode <> 'empty' then
    if p_source_month is null or p_source_month <> date_trunc('month', p_source_month)::date then
      raise exception 'A source logical month is required' using errcode = '22023';
    end if;
  else
    if p_source_month is not null and p_source_month <> date_trunc('month', p_source_month)::date then
      raise exception 'Invalid source logical month' using errcode = '22023';
    end if;
  end if;
  v_target_month := make_date(p_year, p_month, 1);
  v_target := to_char(v_target_month, 'FMMonth_YYYY');
  if exists (select 1 from public.workspace_month_tables where owner_id = p_owner_id and month_start = v_target_month) then
    raise exception 'Month already exists for this workspace' using errcode = '23505';
  end if;
  if p_source_month is not null then
    v_source := public.ensure_workspace_month_registration(p_owner_id, p_source_month);
  else
    select table_name into v_source
    from public.workspace_month_tables
    where owner_id = p_owner_id
    order by month_start desc
    limit 1;
  end if;
  v_target_exists := to_regclass(format('public.%I', v_target)) is not null;
  if not v_target_exists then
    if v_source is not null and to_regclass(format('public.%I', v_source)) is not null then
      execute format('create table public.%I (like public.%I including all)', v_target, v_source);
    else
      execute format('create table public.%I (like public."January_2026" including all)', v_target);
    end if;
    execute format('alter table public.%I enable row level security', v_target);
    execute format(
      'create policy %I on public.%I for all to authenticated
       using (public.has_permanent_workspace_access(workspace_owner_id))
       with check (public.has_permanent_workspace_access(workspace_owner_id))',
      v_target || '_workspace', v_target
    );
  end if;
  perform public.harden_month_workspace_provenance(v_target);
  perform public.lock_month_workspace_provenance(v_target);
  insert into public.workspace_month_tables(owner_id, month_start, table_name, created_by)
  values (p_owner_id, v_target_month, v_target, v_actor);
  if p_copy_mode <> 'empty' then
    v_source_has_deleted := public.month_table_has_column(v_source, 'deleted_at');
    v_copy_filter := 'workspace_owner_id = $1' || case when v_source_has_deleted then ' and deleted_at is null' else '' end;
    if p_copy_mode = 'all' then
      execute format('insert into public.%I select * from public.%I where %s on conflict (id) do nothing', v_target, v_source, v_copy_filter)
        using p_owner_id;
    elsif cardinality(p_member_ids) > 0 then
      execute format('insert into public.%I select * from public.%I where %s and id = any($2) on conflict (id) do nothing', v_target, v_source, v_copy_filter)
        using p_owner_id, p_member_ids;
    end if;
    get diagnostics v_copied = row_count;
  end if;
  -- Kept only as a UI index after the server-owned mapping has succeeded.
  insert into public.user_month_tables(user_id, table_name, month_year)
  values (p_owner_id, v_target, to_char(v_target_month, 'FMMonth YYYY'))
  on conflict (user_id, table_name) do update set month_year = excluded.month_year;
  return jsonb_build_object('success', true, 'table_name', v_target, 'members_copied', v_copied);
end;
$$;


-- Preserve the existing set_workspace_month_member_attendance contract from 20260818231209_add_quick_sunday_list_attendance.sql; only move coordination ahead of narrower locks.
create or replace function public.set_workspace_month_member_attendance(
  p_owner_id uuid,
  p_month_start date,
  p_member_id uuid,
  p_attendance_date date,
  p_attendance_status text,
  p_request_id text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid;
  v_table text;
  v_column text;
  v_has_deleted boolean;
  v_has_updated boolean;
  v_member_exists boolean;
  v_reserved text;
  v_existing jsonb;
  v_response jsonb;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_owner_id is null or p_member_id is null
     or p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date
     or p_attendance_date is null
     or p_attendance_status not in ('Present', 'Absent')
     or nullif(btrim(p_request_id), '') is null then
    raise exception 'Invalid workspace-month attendance request' using errcode = '22023';
  end if;
  if extract(isodow from p_attendance_date) <> 7
     or date_trunc('month', p_attendance_date)::date <> p_month_start then
    raise exception 'Attendance must be a Sunday in the requested logical month' using errcode = '22023';
  end if;

  v_table := public.workspace_month_table_for(p_owner_id, p_month_start);
  insert into public.member_mutation_idempotency(owner_id, table_name, operation_name, request_id, created_by, status, response)
  values (p_owner_id, v_table, 'set_workspace_month_member_attendance', p_request_id, v_actor, 'processing', null)
  on conflict (owner_id, table_name, operation_name, request_id) do nothing
  returning request_id into v_reserved;
  if v_reserved is null then
    select response into v_existing from public.member_mutation_idempotency
    where owner_id = p_owner_id and table_name = v_table
      and operation_name = 'set_workspace_month_member_attendance' and request_id = p_request_id;
    return coalesce(v_existing, jsonb_build_object('success', false, 'error_message', 'Duplicate request is still processing'));
  end if;

  begin
    v_has_deleted := public.month_table_has_column(v_table, 'deleted_at');
    v_has_updated := public.month_table_has_column(v_table, 'updated_at');
    execute format('select exists(select 1 from public.%I where id=$1 and workspace_owner_id=$2%s)',
      v_table, case when v_has_deleted then ' and deleted_at is null' else '' end)
      into v_member_exists using p_member_id, p_owner_id;
    if not v_member_exists then
      raise exception 'Active member is not present in the requested workspace month';
    end if;
    v_column := public.ensure_workspace_attendance_column(p_owner_id, p_month_start, p_attendance_date);
    execute format('update public.%I set %I=$1%s where id=$2 and workspace_owner_id=$3%s',
      v_table, v_column,
      case when v_has_updated then ', updated_at=now()' else '' end,
      case when v_has_deleted then ' and deleted_at is null' else '' end)
      using p_attendance_status, p_member_id, p_owner_id;
    v_response := jsonb_build_object('success', true, 'status', 'updated', 'member_id', p_member_id,
      'target_table', v_table, 'target_month', p_month_start, 'attendance_date', p_attendance_date,
      'attendance_status', p_attendance_status, 'request_id', p_request_id);
  exception when others then
    v_response := jsonb_build_object('success', false, 'status', 'error', 'error_message', sqlerrm, 'request_id', p_request_id);
  end;
  update public.member_mutation_idempotency
  set response=v_response,
      status=case when coalesce((v_response->>'success')::boolean, false) then 'success' else 'failed' end,
      error_message=case when coalesce((v_response->>'success')::boolean, false) then null else v_response->>'error_message' end,
      completed_at=now()
  where owner_id=p_owner_id and table_name=v_table and operation_name='set_workspace_month_member_attendance' and request_id=p_request_id;
  return v_response;
end;
$$;


-- Preserve the existing set_member_attendance_from_other_month contract from 20260928114500_fix_cross_month_attendance_phone_type.sql; only move coordination ahead of narrower locks.
create or replace function public.set_member_attendance_from_other_month(
  p_owner_id uuid, p_source_month date, p_target_month date, p_member_id uuid,
  p_attendance_date date, p_attendance_status text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_source text;
  v_target text;
  v_column text;
  v_source_member jsonb;
  v_target_exists boolean;
  v_target_deleted boolean := false;
  v_source_has_deleted boolean;
  v_target_has_deleted boolean;
  v_target_has_updated boolean;
  v_target_phone_type text;
  v_sql text;
  v_response jsonb;
  v_existing jsonb;
  v_reserved text;
  v_status text;
  v_assignment public.workspace_member_codes%rowtype;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_source_month is null or p_source_month <> date_trunc('month', p_source_month)::date
     or p_target_month is null or p_target_month <> date_trunc('month', p_target_month)::date
     or p_member_id is null or nullif(btrim(p_request_id), '') is null then
    raise exception 'Invalid cross-month attendance request' using errcode = '22023';
  end if;
  if p_attendance_status not in ('Present', 'Absent') or extract(isodow from p_attendance_date) <> 7
     or date_trunc('month', p_attendance_date)::date <> p_target_month then
    raise exception 'Attendance must be an explicit Sunday in the target month' using errcode = '22023';
  end if;
  v_source := public.workspace_month_table_for(p_owner_id, p_source_month);
  v_target := public.workspace_month_table_for(p_owner_id, p_target_month);
  insert into public.member_mutation_idempotency(owner_id, table_name, operation_name, request_id, created_by, status, response)
  values (p_owner_id, v_target, 'set_member_attendance_from_other_month', p_request_id, v_actor, 'processing', null)
  on conflict (owner_id, table_name, operation_name, request_id) do nothing
  returning request_id into v_reserved;
  if v_reserved is null then
    select response into v_existing from public.member_mutation_idempotency
    where owner_id = p_owner_id and table_name = v_target
      and operation_name = 'set_member_attendance_from_other_month' and request_id = p_request_id;
    return coalesce(v_existing, jsonb_build_object('success', false, 'error_message', 'Duplicate request is still processing'));
  end if;
  begin
    v_source_has_deleted := public.month_table_has_column(v_source, 'deleted_at');
    v_target_has_deleted := public.month_table_has_column(v_target, 'deleted_at');
    v_target_has_updated := public.month_table_has_column(v_target, 'updated_at');
    v_sql := format('select to_jsonb(s.*) from public.%I s where s.id = $1 and s.workspace_owner_id = $2%s limit 1',
      v_source, case when v_source_has_deleted then ' and s.deleted_at is null' else '' end);
    execute v_sql into v_source_member using p_member_id, p_owner_id;
    if v_source_member is null then
      raise exception 'Active member is not present in the source workspace month';
    end if;
    v_column := public.ensure_workspace_attendance_column(p_owner_id, p_target_month, p_attendance_date);
    execute format('select exists(select 1 from public.%I where id=$1 and workspace_owner_id = $2)', v_target)
      into v_target_exists using p_member_id, p_owner_id;
    if v_target_exists then
      if v_target_has_deleted then
        execute format('select exists(select 1 from public.%I where id=$1 and workspace_owner_id = $2 and deleted_at is not null)', v_target)
          into v_target_deleted using p_member_id, p_owner_id;
      end if;
      execute format('update public.%I set %I=$1%s%s where id=$2 and workspace_owner_id = $3',
        v_target, v_column,
        case when v_target_deleted then ', deleted_at=null' else '' end,
        case when v_target_has_updated then ', updated_at=now()' else '' end)
        using p_attendance_status, p_member_id, p_owner_id;
      v_status := case when v_target_deleted then 'restored' else 'already_present_in_month' end;
    else
      -- The source and target month schemas differ across legitimate legacy
      -- tables.  Copy only their shared non-system columns, and keep owner and
      -- attendance values server-derived.
      execute format(
        'insert into public.%I (id, user_id, workspace_owner_id, %I)
         select $1, $2, $2, $3
         on conflict (id) do nothing', v_target, v_column
      ) using p_member_id, p_owner_id, p_attendance_status;
      -- Populate safe profile fields only when those columns exist on both sides.
      if public.month_table_has_column(v_source, 'Full Name') and public.month_table_has_column(v_target, 'Full Name') then
        execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Full Name') using v_source_member->>'Full Name', p_member_id, p_owner_id;
      end if;
      if public.month_table_has_column(v_source, 'Gender') and public.month_table_has_column(v_target, 'Gender') then
        execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Gender') using v_source_member->>'Gender', p_member_id, p_owner_id;
      end if;
      if public.month_table_has_column(v_source, 'Phone Number') and public.month_table_has_column(v_target, 'Phone Number') then
        select data_type into v_target_phone_type
        from information_schema.columns
        where table_schema = 'public' and table_name = v_target and column_name = 'Phone Number';
        if v_target_phone_type in ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') then
          execute format('update public.%I set %I = nullif($1, '''')::%s where id=$2 and workspace_owner_id = $3', v_target, 'Phone Number', v_target_phone_type)
            using v_source_member->>'Phone Number', p_member_id, p_owner_id;
        else
          execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Phone Number')
            using v_source_member->>'Phone Number', p_member_id, p_owner_id;
        end if;
      end if;
      if public.month_table_has_column(v_source, 'Current Level') and public.month_table_has_column(v_target, 'Current Level') then
        execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Current Level') using v_source_member->>'Current Level', p_member_id, p_owner_id;
      end if;
      v_status := 'imported_and_present';
    end if;
    v_assignment := public.ensure_workspace_member_code(p_owner_id, jsonb_build_object('id', p_member_id));
    execute format('select to_jsonb(t.*) from public.%I t where id=$1 and t.workspace_owner_id = $2', v_target)
      into v_existing using p_member_id, p_owner_id;
    v_response := jsonb_build_object('success', true, 'status', v_status, 'member_id', p_member_id,
      'member', v_existing, 'member_code', v_assignment.current_code, 'code_assignment', to_jsonb(v_assignment),
      'source_table', v_source, 'target_table', v_target, 'attendance_date', p_attendance_date,
      'attendance_status', p_attendance_status, 'request_id', p_request_id);
  exception when others then
    v_response := jsonb_build_object('success', false, 'status', 'error', 'error_message', sqlerrm, 'request_id', p_request_id);
  end;
  update public.member_mutation_idempotency
  set response = v_response, status = case when coalesce((v_response->>'success')::boolean, false) then 'success' else 'failed' end,
      error_message = case when coalesce((v_response->>'success')::boolean, false) then null else v_response->>'error_message' end,
      completed_at = now()
  where owner_id = p_owner_id and table_name = v_target and operation_name = 'set_member_attendance_from_other_month' and request_id = p_request_id;
  return v_response;
end;
$$;


-- Preserve the existing update_member_record contract from 20260814122618_20260813170000_harden_paper_scan_final_save.sql; only move coordination ahead of narrower locks.
create or replace function public.update_member_record(
  p_table_name text, p_member_id uuid, p_updates jsonb, p_owner_id uuid
) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_target jsonb; v_table text; v_key text; v_val jsonb; v_set text := ''; v_count integer;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, '{}'::jsonb);
  v_table := v_target ->> 'table_name';
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'Updates must be a JSON object' using errcode = '22023';
  end if;
  for v_key, v_val in select key, value from jsonb_each(p_updates) loop
    if v_key not in ('Full Name','Phone Number','Gender','Age','Current Level','date_of_birth',
      'parent_name_1','parent_phone_1','parent_name_2','parent_phone_2','notes','ministry','is_visitor',
      'Member','Regular','Newcomer','Manual Badge','Badge Type','updated_at')
       or not public.month_table_has_column(v_table, v_key) then
      raise exception 'Unsupported member field' using errcode = '22023';
    end if;
    v_set := v_set || case when v_set = '' then '' else ', ' end ||
      case when v_val is null or v_val = 'null'::jsonb then format('%I = null', v_key)
           else format('%I = %L', v_key, v_val #>> '{}') end;
  end loop;
  if v_set = '' then raise exception 'No permitted member fields supplied' using errcode = '22023'; end if;
  execute format('update public.%I set %s where id = $1 and workspace_owner_id = $2', v_table, v_set)
    using p_member_id, p_owner_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Trusted member update affected % rows', v_count using errcode = '42501'; end if;
end;
$$;


-- Preserve the existing ensure_workspace_member_codes contract from 20260814122618_20260813170000_harden_paper_scan_final_save.sql; only move coordination ahead of narrower locks.
create or replace function public.ensure_workspace_member_codes(p_owner_id uuid, p_members jsonb)
returns setof public.workspace_member_codes
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_format text := 'alphanumeric';
  v_length smallint := 3;
  v_next_ordinal bigint := 0;
  v_candidate text;
  v_prefix text;
  v_suffix bigint;
  v_width integer;
  v_member record;
  v_lock_id uuid;
  v_effective_legacy text;
begin
  perform public.member_v2_begin_workspace_write(p_owner_id);
  perform public.require_permanent_workspace_actor(p_owner_id, false);

  if jsonb_typeof(p_members) <> 'array' or coalesce(p_members, '[]'::jsonb) = '[]'::jsonb then
    return;
  end if;

  select
    coalesce(member_code_format, 'alphanumeric'),
    coalesce(member_code_length, 3)::smallint
  into v_format, v_length
  from public.user_preferences
  where user_id = p_owner_id;

  v_format := coalesce(v_format, 'alphanumeric');
  v_length := coalesce(v_length, 3::smallint);

  -- Phase 1: Acquire member-scoped advisory locks in deterministic UUID order for all distinct requested members
  for v_lock_id in
    select distinct nullif(value ->> 'id', '')::uuid as member_id
    from jsonb_array_elements(p_members)
    where nullif(value ->> 'id', '') is not null
    order by member_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 0));
  end loop;

  -- Phase 2: Acquire the workspace sequential code allocator lock ONCE per batch AFTER all member locks are held
  perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));

  -- Phase 3: Perform server-proven validation and sequential allocation for each distinct member
  for v_member in
    select distinct on (member_id)
      member_id,
      legacy_code
    from (
      select
        nullif(value ->> 'id', '')::uuid as member_id,
        upper(regexp_replace(coalesce(value ->> 'legacy_code', ''), '[^A-Za-z0-9]', '', 'g')) as legacy_code
      from jsonb_array_elements(p_members)
    ) incoming
    where member_id is not null
    order by member_id, legacy_code
  loop
    -- Defensive exclusion check
    if exists (
      select 1 from public.workspace_member_provenance_exclusions where member_id = v_member.member_id
    ) then
      raise exception 'Member id % is excluded from workspace provenance', v_member.member_id using errcode = '42501';
    end if;

    -- Defensive foreign workspace claim check
    if exists (
      select 1 from public.workspace_member_codes
      where member_id = v_member.member_id and workspace_owner_id <> p_owner_id
    ) then
      raise exception 'Member id % belongs to another workspace', v_member.member_id using errcode = '42501';
    end if;

    -- Idempotent check: if already allocated under this workspace, preserve it
    if exists (
      select 1
      from public.workspace_member_codes existing
      where existing.workspace_owner_id = p_owner_id
        and existing.member_id = v_member.member_id
    ) then
      continue;
    end if;

    -- Server-side proof that member belongs to authorized workspace
    if not public.member_belongs_to_workspace(p_owner_id, v_member.member_id) then
      raise exception 'Member id % does not belong to authorized workspace %', v_member.member_id, p_owner_id using errcode = '42501';
    end if;

    select coalesce(max(ordinal), 0)
    into v_next_ordinal
    from public.workspace_member_codes
    where workspace_owner_id = p_owner_id;

    v_next_ordinal := v_next_ordinal + 1;

    if v_format = 'letters' then
      v_candidate := public.member_code_letters(v_next_ordinal, v_length);
    elsif v_format = 'numbers' then
      v_width := greatest(v_length::integer, length(v_next_ordinal::text));
      v_candidate := lpad(v_next_ordinal::text, v_width, '0');
    else
      v_prefix := coalesce(nullif(substring(v_member.legacy_code from '^[A-Z]'), ''), 'A');

      select coalesce(max((substring(current_code from '^[A-Z]([0-9]+)$'))::bigint), 0)
      into v_suffix
      from public.workspace_member_codes
      where workspace_owner_id = p_owner_id
        and current_code ~ ('^' || v_prefix || '[0-9]+$');

      v_suffix := v_suffix + 1;
      loop
        v_width := greatest((v_length - 1)::integer, length(v_suffix::text));
        v_candidate := v_prefix || lpad(v_suffix::text, v_width, '0');
        exit when not exists (
          select 1
          from public.workspace_member_codes collision
          where collision.workspace_owner_id = p_owner_id
            and collision.current_code = v_candidate
        );
        v_suffix := v_suffix + 1;
      end loop;
    end if;

    v_effective_legacy := coalesce(nullif(btrim(coalesce(v_member.legacy_code, '')), ''), v_candidate);

    insert into public.workspace_member_codes (
      workspace_owner_id,
      member_id,
      ordinal,
      legacy_code,
      current_code,
      aliases,
      created_at,
      updated_at
    ) values (
      p_owner_id,
      v_member.member_id,
      v_next_ordinal,
      v_effective_legacy,
      v_candidate,
      case
        when nullif(btrim(coalesce(v_member.legacy_code, '')), '') is not null
          and upper(v_member.legacy_code) <> upper(v_candidate)
          then array[upper(v_member.legacy_code)]::text[]
        else '{}'::text[]
      end,
      now(),
      now()
    )
    on conflict (workspace_owner_id, member_id) do nothing;
  end loop;

  return query
  select assignment.*
  from public.workspace_member_codes assignment
  where assignment.workspace_owner_id = p_owner_id
    and assignment.member_id in (
      select distinct nullif(value ->> 'id', '')::uuid
      from jsonb_array_elements(p_members)
      where nullif(value ->> 'id', '') is not null
    )
  order by assignment.ordinal;
end;
$$;


-- Preserve the existing paper_scan_execute_save_step contract from 20260826044700_harden_paper_scan_profile_fields.sql; only move coordination ahead of narrower locks.
create or replace function public.paper_scan_execute_save_step(p_operation_id uuid, p_step_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  o public.paper_scan_save_operations%rowtype;
  s public.paper_scan_save_steps%rowtype;
  v_table text;
  v_column text;
  v_sql text;
  v_cols text := '';
  v_vals text := '';
  v_set text := '';
  v_count integer := 0;
  v_has_deleted boolean;
  v_authorized boolean := false;
  -- Duplicate-guard locals
  v_row_number integer;
  v_row_key text;
  v_override_keys text[] := array[]::text[];
  v_norm_phone text;
  v_norm_name text;
  v_candidate_id uuid;
  v_candidate_name text;
  v_candidate_phone text;
begin
  -- These checks are intentionally outside the exception block.  An unknown,
  -- anonymous, inactive, cross-workspace, or foreign-plan caller cannot reach
  -- either the step or operation failure updates below.
  v_actor := auth.uid();
  if v_actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A permanent authenticated user is required' using errcode = '42501';
  end if;
  select * into o from public.paper_scan_save_operations where id = p_operation_id;
  if not found then raise exception 'Unknown save operation' using errcode = '42501'; end if;
  perform public.member_v2_begin_workspace_write(o.owner_id);
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

      -- Identity-scoped serialization: two sessions creating the same likely
      -- person cannot both pass the fresh duplicate check below. Lock the
      -- normalized identity (phone preferred, name fallback), NOT the new UUID.
      perform pg_advisory_xact_lock(public.paper_scan_identity_lock_key(
        o.owner_id,
        coalesce(s.member_payload ->> 'Phone Number', s.member_payload ->> 'phone_number'),
        coalesce(s.member_payload ->> 'Full Name', s.member_payload ->> 'full_name')
      ));

      -- Fresh candidate recheck inside the authorized workspace/month. Only an
      -- ACTIVE row with BOTH normalized phone and normalized name matching is a
      -- blocking candidate — a shared family phone with a different name is never
      -- auto-merged here. A confirmed duplicate override on the immutable plan
      -- (operator explicitly resolved the row) still permits the create.
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

      -- Build the INSERT column list dynamically so optional profile columns
      -- (Age and Parent/Guardian fields) are persisted only when the trusted
      -- month table actually has them. Legacy tables never fail on a missing
      -- optional column; the core identity fields remain the required minimum.
      v_cols := '';
      v_vals := '';
      if public.month_table_has_column(v_table, 'Full Name') then
        v_cols := v_cols || ', ' || format('%I', 'Full Name');
        v_vals := v_vals || ', ' || quote_nullable(coalesce(s.member_payload ->> 'Full Name', s.member_payload ->> 'full_name'));
      end if;
      if public.month_table_has_column(v_table, 'Gender') then
        v_cols := v_cols || ', ' || format('%I', 'Gender');
        v_vals := v_vals || ', ' || quote_nullable(coalesce(s.member_payload ->> 'Gender', s.member_payload ->> 'gender'));
      end if;
      if public.month_table_has_column(v_table, 'Phone Number') then
        v_cols := v_cols || ', ' || format('%I', 'Phone Number');
        v_vals := v_vals || ', ' || quote_nullable(coalesce(s.member_payload ->> 'Phone Number', s.member_payload ->> 'phone_number'));
      end if;
      if public.month_table_has_column(v_table, 'Age') then
        v_cols := v_cols || ', ' || format('%I', 'Age');
        v_vals := v_vals || ', ' || quote_nullable(coalesce(s.member_payload ->> 'Age', s.member_payload ->> 'age'));
      end if;
      if public.month_table_has_column(v_table, 'Current Level') then
        v_cols := v_cols || ', ' || format('%I', 'Current Level');
        v_vals := v_vals || ', ' || quote_nullable(coalesce(s.member_payload ->> 'Current Level', s.member_payload ->> 'current_level'));
      end if;
      if public.month_table_has_column(v_table, 'parent_name_1') then
        v_cols := v_cols || ', ' || format('%I', 'parent_name_1');
        v_vals := v_vals || ', ' || quote_nullable(s.member_payload ->> 'parent_name_1');
      end if;
      if public.month_table_has_column(v_table, 'parent_phone_1') then
        v_cols := v_cols || ', ' || format('%I', 'parent_phone_1');
        v_vals := v_vals || ', ' || quote_nullable(s.member_payload ->> 'parent_phone_1');
      end if;

      v_sql := format('insert into public.%I (id, user_id, workspace_owner_id%s) values ($1,$2,$2%s) on conflict (id) do nothing',
        v_table, v_cols, v_vals);
      execute v_sql using s.member_id, o.owner_id;
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

      -- Build the SET clause dynamically. Only fields present in the immutable
      -- profile payload AND present as real columns on the trusted table are
      -- written. Untouched fields are never overwritten, and legacy tables that
      -- lack Age or parent columns simply skip them.
      v_set := '';
      if (s.profile_payload ? 'full_name' or s.profile_payload ? 'Full Name')
         and public.month_table_has_column(v_table, 'Full Name') then
        v_set := v_set || format('%I = %L, ', 'Full Name', coalesce(s.profile_payload ->> 'Full Name', s.profile_payload ->> 'full_name'));
      end if;
      if (s.profile_payload ? 'phone_number' or s.profile_payload ? 'Phone Number')
         and public.month_table_has_column(v_table, 'Phone Number') then
        v_set := v_set || format('%I = %L, ', 'Phone Number', coalesce(s.profile_payload ->> 'Phone Number', s.profile_payload ->> 'phone_number'));
      end if;
      if (s.profile_payload ? 'gender' or s.profile_payload ? 'Gender')
         and public.month_table_has_column(v_table, 'Gender') then
        v_set := v_set || format('%I = %L, ', 'Gender', coalesce(s.profile_payload ->> 'Gender', s.profile_payload ->> 'gender'));
      end if;
      if (s.profile_payload ? 'age' or s.profile_payload ? 'Age')
         and public.month_table_has_column(v_table, 'Age') then
        v_set := v_set || format('%I = %L, ', 'Age', coalesce(s.profile_payload ->> 'Age', s.profile_payload ->> 'age'));
      end if;
      if (s.profile_payload ? 'current_level' or s.profile_payload ? 'Current Level')
         and public.month_table_has_column(v_table, 'Current Level') then
        v_set := v_set || format('%I = %L, ', 'Current Level', coalesce(s.profile_payload ->> 'Current Level', s.profile_payload ->> 'current_level'));
      end if;
      if s.profile_payload ? 'parent_name_1' and public.month_table_has_column(v_table, 'parent_name_1') then
        v_set := v_set || format('%I = %L, ', 'parent_name_1', s.profile_payload ->> 'parent_name_1');
      end if;
      if s.profile_payload ? 'parent_phone_1' and public.month_table_has_column(v_table, 'parent_phone_1') then
        v_set := v_set || format('%I = %L, ', 'parent_phone_1', s.profile_payload ->> 'parent_phone_1');
      end if;

      if v_set = '' then
        raise exception 'No supported profile fields in the trusted month table';
      end if;

      v_sql := format('update public.%I set %s where id=$1 and workspace_owner_id = $2%s',
        v_table,
        rtrim(v_set, ', '),
        case when v_has_deleted then ' and deleted_at is null' else '' end);
      execute v_sql using s.member_id, o.owner_id;
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


notify pgrst, 'reload schema';
