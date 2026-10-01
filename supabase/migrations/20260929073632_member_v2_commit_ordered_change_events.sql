-- Serialize event revisions per permanent workspace until the publishing
-- transaction commits. The identity sequence remains globally unique, while
-- this transaction-scoped lock prevents a later revision for the same owner
-- from becoming visible before an earlier live revision.
create or replace function public.member_v2_lock_change_event_order(p_owner_id uuid)
returns void
language sql volatile security definer set search_path = pg_catalog, public, pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended(
    'datser.member_v2.change-feed:' || p_owner_id::text,
    0
  ));
$$;

revoke all on function public.member_v2_lock_change_event_order(uuid) from public, anon, authenticated;

-- This is the single profile/tombstone/bootstrap event writer used by trusted
-- RPCs and legacy-capture triggers. Acquire the owner lock before INSERT so
-- the identity value itself is assigned only after earlier same-owner writers
-- have committed or rolled back.
create or replace function public.member_v2_record_change(
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid,
  p_member_payload jsonb,
  p_is_deleted boolean,
  p_operation_name text,
  p_request_id text default null,
  p_actor_id uuid default null
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_revision bigint;
  v_payload jsonb := coalesce(p_member_payload, '{}'::jsonb);
begin
  perform public.member_v2_lock_change_event_order(p_owner_id);

  insert into public.member_v2_change_events(
    owner_id, table_name, member_id, is_deleted, operation_name, request_id, actor_id, member_payload
  ) values (
    p_owner_id, p_table_name, p_member_id, coalesce(p_is_deleted, false), p_operation_name,
    p_request_id, p_actor_id, v_payload
  ) returning server_revision into v_revision;

  insert into public.member_v2_heads(
    owner_id, table_name, member_id, server_revision, is_deleted, member_payload, updated_at
  ) values (
    p_owner_id, p_table_name, p_member_id, v_revision, coalesce(p_is_deleted, false), v_payload, clock_timestamp()
  ) on conflict (owner_id, table_name, member_id) do update set
    server_revision = excluded.server_revision,
    is_deleted = excluded.is_deleted,
    member_payload = excluded.member_payload,
    updated_at = excluded.updated_at;

  insert into public.member_v2_realtime_signals(owner_id, latest_server_revision)
  values (p_owner_id, v_revision);
  return v_revision;
end;
$$;

revoke all on function public.member_v2_record_change(uuid, text, uuid, jsonb, boolean, text, text, uuid) from public, anon, authenticated;
grant execute on function public.member_v2_record_change(uuid, text, uuid, jsonb, boolean, text, text, uuid) to service_role;

-- Canonical lock order: acquire the owner feed lock before any narrower
-- attendance-cell or event-row lock. Bootstrap paths take the same broad lock
-- before walking cells, so a writer cannot hold a cell lock while waiting for
-- a bootstrap transaction that is waiting for that cell.
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

  perform public.member_v2_lock_change_event_order(p_owner_id);

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

  insert into public.member_v2_realtime_signals(owner_id, latest_server_revision)
  values (p_owner_id, v_revision);

  return v_revision;
end;
$$;

revoke all on function public.member_v2_lock_change_event_order(uuid) from public, anon, authenticated;
revoke all on function public.member_v2_record_change(uuid, text, uuid, jsonb, boolean, text, text, uuid) from public, anon, authenticated;

-- Profile bootstrap uses the same broad-before-narrow order as the publishers.
-- The owner lock remains held until the surrounding RPC commits or rolls back.
create or replace function public.member_v2_bootstrap_head(
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_existing bigint;
  v_payload jsonb;
  v_deleted boolean;
begin
  perform public.member_v2_lock_change_event_order(p_owner_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'member_v2_head:' || p_owner_id::text || ':' || p_table_name || ':' || p_member_id::text,
    0
  ));
  select server_revision into v_existing
  from public.member_v2_heads
  where owner_id = p_owner_id and table_name = p_table_name and member_id = p_member_id
  for update;
  if v_existing is not null then
    return v_existing;
  end if;
  v_payload := public.member_v2_member_payload(p_table_name, p_owner_id, p_member_id, true);
  if v_payload is null then
    raise exception 'Member is unavailable for synchronization' using errcode = '42501';
  end if;
  v_deleted := nullif(v_payload ->> 'deleted_at', '') is not null;
  return public.member_v2_record_change(
    p_owner_id, p_table_name, p_member_id, v_payload, v_deleted, 'bootstrap', null, auth.uid()
  );
end;
$$;

create or replace function public.member_v2_bootstrap_workspace(p_owner_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r record;
  v_member_id uuid;
  v_has_deleted boolean;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  perform public.member_v2_lock_change_event_order(p_owner_id);
  for r in
    select distinct table_name
    from public.workspace_month_tables
    where owner_id = p_owner_id
  loop
    v_has_deleted := public.month_table_has_column(r.table_name, 'deleted_at');
    for v_member_id in execute format(
      'select id from public.%I where workspace_owner_id = $1%s order by id',
      r.table_name,
      case when v_has_deleted then '' else '' end
    ) using p_owner_id loop
      perform public.member_v2_bootstrap_head(p_owner_id, r.table_name, v_member_id);
    end loop;
  end loop;
end;
$$;

-- Attendance bootstrap reads the canonical month cell only after obtaining the
-- owner lock. The scoped date lock and event-row lock are acquired later by the
-- shared attendance writer in the same deterministic order.
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
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  perform public.member_v2_lock_change_event_order(p_owner_id);
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
  perform public.member_v2_lock_change_event_order(p_owner_id);
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

notify pgrst, 'reload schema';
