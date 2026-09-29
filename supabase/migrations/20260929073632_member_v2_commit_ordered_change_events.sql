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

-- Attendance has an additional per-member/date lock for canonical-cell
-- idempotency. This owner-scoped lock orders its change-feed revision with
-- profile, delete, bootstrap, and legacy-captured event revisions.
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

  perform public.member_v2_lock_change_event_order(p_owner_id);

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

notify pgrst, 'reload schema';
