-- Isolated Phase 1 Member V2 attendance contract.
-- This deliberately does not read or write DatSer's production monthly
-- attendance columns. It exists only for the local Member V2 harness.

create table if not exists public.member_v2_attendance_mutations (
  request_id text primary key check (char_length(btrim(request_id)) between 1 and 200),
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null,
  attendance_date date not null,
  operation_name text not null check (operation_name in ('set_member_v2_attendance', 'clear_member_v2_attendance')),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('PROCESSING', 'SUCCESS', 'CONFLICT', 'FAILED')),
  response jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create table if not exists public.member_v2_attendance_change_events (
  server_revision bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null,
  table_name text not null,
  attendance_date date not null,
  attendance_id uuid not null,
  attendance_status text check (attendance_status in ('Present', 'Absent')),
  is_deleted boolean not null default false,
  operation_name text not null,
  request_id text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists member_v2_attendance_events_owner_revision_idx
  on public.member_v2_attendance_change_events(owner_id, server_revision, member_id);

create table if not exists public.member_v2_attendance_heads (
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null,
  attendance_date date not null,
  table_name text not null,
  attendance_id uuid not null,
  server_revision bigint not null references public.member_v2_attendance_change_events(server_revision),
  attendance_status text check (attendance_status in ('Present', 'Absent')),
  is_deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, member_id, attendance_date)
);

create table if not exists public.member_v2_attendance_realtime_signals (
  signal_id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  latest_server_revision bigint not null references public.member_v2_attendance_change_events(server_revision) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.member_v2_attendance_mutations enable row level security;
alter table public.member_v2_attendance_change_events enable row level security;
alter table public.member_v2_attendance_heads enable row level security;
alter table public.member_v2_attendance_realtime_signals enable row level security;

drop policy if exists "member v2 attendance signal read" on public.member_v2_attendance_realtime_signals;
create policy "member v2 attendance signal read" on public.member_v2_attendance_realtime_signals
  for select to authenticated using (public.has_permanent_workspace_access(owner_id));

revoke all on public.member_v2_attendance_mutations from public, anon, authenticated;
revoke all on public.member_v2_attendance_change_events from public, anon, authenticated;
revoke all on public.member_v2_attendance_heads from public, anon, authenticated;
revoke all on public.member_v2_attendance_realtime_signals from public, anon, authenticated;
grant select on public.member_v2_attendance_realtime_signals to authenticated;

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

create or replace function public.member_v2_attendance_reserve_mutation(
  p_request_id text, p_owner_id uuid, p_member_id uuid, p_attendance_date date,
  p_operation_name text, p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_existing public.member_v2_attendance_mutations%rowtype;
begin
  if p_request_id is null or btrim(p_request_id) = '' then raise exception 'Request id is required' using errcode = '22023'; end if;
  select * into v_existing from public.member_v2_attendance_mutations where request_id = p_request_id for update;
  if found then
    if v_existing.owner_id <> p_owner_id or v_existing.member_id <> p_member_id
       or v_existing.attendance_date <> p_attendance_date or v_existing.operation_name <> p_operation_name
       or v_existing.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'Request id was already used for a different attendance mutation' using errcode = '22023';
    end if;
    if v_existing.response is not null then
      return jsonb_build_object('reserved', false, 'response', v_existing.response || jsonb_build_object('status', 'IDEMPOTENT_REPLAY', 'original_status', v_existing.status));
    end if;
    return jsonb_build_object('reserved', false, 'response', jsonb_build_object('status', 'IN_PROGRESS', 'request_id', p_request_id));
  end if;
  insert into public.member_v2_attendance_mutations(request_id, owner_id, member_id, attendance_date, operation_name, payload_fingerprint, status, created_by)
  values (p_request_id, p_owner_id, p_member_id, p_attendance_date, p_operation_name, p_payload_fingerprint, 'PROCESSING', auth.uid());
  return jsonb_build_object('reserved', true);
end;
$$;

create or replace function public.member_v2_attendance_finish_mutation(p_request_id text, p_status text, p_response jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  update public.member_v2_attendance_mutations set status = p_status, response = p_response, completed_at = clock_timestamp() where request_id = p_request_id;
  if not found then raise exception 'Attendance mutation reservation was lost' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.save_member_v2_attendance(
  p_owner_id uuid, p_member_id uuid, p_table_name text, p_attendance_date date,
  p_attendance_status text, p_attendance_id uuid, p_base_server_revision bigint,
  p_request_id text, p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_operation text := case when p_attendance_status is null then 'clear_member_v2_attendance' else 'set_member_v2_attendance' end;
  v_expected_fingerprint text; v_reservation jsonb; v_head public.member_v2_attendance_heads%rowtype;
  v_revision bigint; v_response jsonb;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$' or p_attendance_date is null then raise exception 'Invalid isolated attendance target' using errcode = '22023'; end if;
  if p_attendance_status is not null and p_attendance_status not in ('Present', 'Absent') then raise exception 'Attendance status must be Present, Absent, or Clear' using errcode = '22023'; end if;
  if not exists (select 1 from public.member_v2_claims where owner_id = p_owner_id and member_id = p_member_id and table_name = p_table_name) then
    raise exception 'Member is unavailable for isolated attendance' using errcode = '42501';
  end if;
  v_expected_fingerprint := public.member_v2_attendance_fingerprint(v_operation, p_owner_id, p_member_id, p_table_name, p_attendance_date, p_attendance_status, p_base_server_revision);
  if p_payload_fingerprint is distinct from v_expected_fingerprint then raise exception 'Attendance payload fingerprint does not match' using errcode = '22023'; end if;
  v_reservation := public.member_v2_attendance_reserve_mutation(p_request_id, p_owner_id, p_member_id, p_attendance_date, v_operation, p_payload_fingerprint);
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then return v_reservation -> 'response'; end if;
  perform pg_advisory_xact_lock(hashtextextended('member_v2_attendance:' || p_owner_id::text || ':' || p_member_id::text || ':' || p_attendance_date::text, 0));
  select * into v_head from public.member_v2_attendance_heads where owner_id = p_owner_id and member_id = p_member_id and attendance_date = p_attendance_date for update;
  if found and p_base_server_revision is distinct from v_head.server_revision then
    v_response := jsonb_build_object('status','CONFLICT','server_revision',v_head.server_revision,'attendance',jsonb_build_object('attendance_id',v_head.attendance_id::text,'attendance_date',v_head.attendance_date::text,'status',v_head.attendance_status,'is_deleted',v_head.is_deleted,'table_name',v_head.table_name));
    perform public.member_v2_attendance_finish_mutation(p_request_id, 'CONFLICT', v_response); return v_response;
  end if;
  if not found and p_base_server_revision is not null then
    v_response := jsonb_build_object('status','CONFLICT','server_revision',null,'attendance',null);
    perform public.member_v2_attendance_finish_mutation(p_request_id, 'CONFLICT', v_response); return v_response;
  end if;
  insert into public.member_v2_attendance_change_events(owner_id, member_id, table_name, attendance_date, attendance_id, attendance_status, is_deleted, operation_name, request_id, actor_id)
  values (p_owner_id, p_member_id, p_table_name, p_attendance_date, coalesce(v_head.attendance_id, p_attendance_id), p_attendance_status, p_attendance_status is null, v_operation, p_request_id, auth.uid())
  returning server_revision into v_revision;
  insert into public.member_v2_attendance_heads(owner_id, member_id, attendance_date, table_name, attendance_id, server_revision, attendance_status, is_deleted, updated_at)
  values (p_owner_id, p_member_id, p_attendance_date, p_table_name, coalesce(v_head.attendance_id, p_attendance_id), v_revision, p_attendance_status, p_attendance_status is null, clock_timestamp())
  on conflict (owner_id, member_id, attendance_date) do update set table_name=excluded.table_name, attendance_id=excluded.attendance_id, server_revision=excluded.server_revision, attendance_status=excluded.attendance_status, is_deleted=excluded.is_deleted, updated_at=excluded.updated_at;
  insert into public.member_v2_attendance_realtime_signals(owner_id, latest_server_revision) values (p_owner_id, v_revision);
  v_response := jsonb_build_object('status','SUCCESS','server_revision',v_revision,'attendance',jsonb_build_object('attendance_id',coalesce(v_head.attendance_id,p_attendance_id)::text,'attendance_date',p_attendance_date::text,'status',p_attendance_status,'is_deleted',p_attendance_status is null,'table_name',p_table_name));
  perform public.member_v2_attendance_finish_mutation(p_request_id, 'SUCCESS', v_response); return v_response;
end;
$$;

create or replace function public.pull_member_v2_attendance_changes_v2(p_owner_id uuid, p_after_server_revision bigint default null, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_changes jsonb; v_next bigint; v_more boolean;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'Invalid pull limit' using errcode='22023'; end if;
  with rows as (select server_revision, table_name, member_id, attendance_date, attendance_id, attendance_status, is_deleted, operation_name, created_at from public.member_v2_attendance_change_events where owner_id=p_owner_id and server_revision > coalesce(p_after_server_revision,0) order by server_revision limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('server_revision',server_revision,'table_name',table_name,'member_id',member_id,'attendance_date',attendance_date::text,'attendance_id',attendance_id::text,'status',attendance_status,'is_deleted',is_deleted,'operation',operation_name,'changed_at',created_at) order by server_revision),'[]'::jsonb), max(server_revision) into v_changes,v_next from rows;
  select exists(select 1 from public.member_v2_attendance_change_events where owner_id=p_owner_id and server_revision > coalesce(v_next,p_after_server_revision,0)) into v_more;
  return jsonb_build_object('status','SUCCESS','changes',v_changes,'next_cursor',v_next,'has_more',v_more);
end;
$$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='member_v2_attendance_realtime_signals') then
    alter publication supabase_realtime add table public.member_v2_attendance_realtime_signals;
  end if;
end $$;

revoke all on function public.member_v2_attendance_fingerprint(text,uuid,uuid,text,date,text,bigint) from public, anon, authenticated;
revoke all on function public.member_v2_attendance_reserve_mutation(text,uuid,uuid,date,text,text) from public, anon, authenticated;
revoke all on function public.member_v2_attendance_finish_mutation(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.save_member_v2_attendance(uuid,uuid,text,date,text,uuid,bigint,text,text) from public, anon;
revoke all on function public.pull_member_v2_attendance_changes_v2(uuid,bigint,integer) from public, anon;
grant execute on function public.save_member_v2_attendance(uuid,uuid,text,date,text,uuid,bigint,text,text) to authenticated;
grant execute on function public.pull_member_v2_attendance_changes_v2(uuid,bigint,integer) to authenticated;
notify pgrst, 'reload schema';
