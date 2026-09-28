-- POC ONLY: isolated RxDB backend experiment. This is not a production migration plan.

create schema if not exists poc_private;
revoke all on schema poc_private from public, anon;
grant usage on schema poc_private to authenticated;

create table public.poc_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  is_deleted boolean not null default false
);

create table public.poc_workspace_members (
  workspace_id uuid not null references public.poc_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'collaborator')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, user_id)
);

create table public.poc_members (
  id uuid primary key,
  workspace_id uuid not null references public.poc_workspaces(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  is_deleted boolean not null default false
);

create table public.poc_attendance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.poc_workspaces(id) on delete cascade,
  member_id uuid not null references public.poc_members(id) on delete cascade,
  attendance_date date not null,
  status text check (status in ('present', 'absent') or status is null),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  is_deleted boolean not null default false,
  unique (workspace_id, member_id, attendance_date),
  check ((is_deleted and status is null) or (not is_deleted and status is not null))
);

create table public.poc_mutation_idempotency (
  workspace_id uuid not null references public.poc_workspaces(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 200),
  operation text not null,
  payload_hash text not null,
  result jsonb not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, request_id)
);

create table public.poc_audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.poc_workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id text not null,
  operation text not null,
  entity_type text not null check (entity_type in ('workspace', 'member', 'attendance')),
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index poc_members_pull_checkpoint_idx
  on public.poc_members (workspace_id, updated_at, id);
create index poc_attendance_pull_checkpoint_idx
  on public.poc_attendance (workspace_id, updated_at, id);
create index poc_audit_workspace_created_idx
  on public.poc_audit_log (workspace_id, created_at, id);

-- Realtime must receive the complete workspace-scoped row for filtered UPDATE/DELETE wakeups.
alter table public.poc_members replica identity full;
alter table public.poc_attendance replica identity full;

create or replace function poc_private.has_workspace_access(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.poc_workspace_members membership
    where membership.workspace_id = p_workspace_id
      and membership.user_id = (select auth.uid())
  );
$$;

revoke all on function poc_private.has_workspace_access(uuid) from public, anon;
grant execute on function poc_private.has_workspace_access(uuid) to authenticated;

alter table public.poc_workspaces enable row level security;
alter table public.poc_workspace_members enable row level security;
alter table public.poc_members enable row level security;
alter table public.poc_attendance enable row level security;
alter table public.poc_mutation_idempotency enable row level security;
alter table public.poc_audit_log enable row level security;

create policy poc_workspaces_read on public.poc_workspaces
for select to authenticated
using ((select poc_private.has_workspace_access(id)));

create policy poc_workspace_members_read on public.poc_workspace_members
for select to authenticated
using ((select poc_private.has_workspace_access(workspace_id)));

create policy poc_members_read on public.poc_members
for select to authenticated
using ((select poc_private.has_workspace_access(workspace_id)));

create policy poc_attendance_read on public.poc_attendance
for select to authenticated
using ((select poc_private.has_workspace_access(workspace_id)));

create policy poc_idempotency_read on public.poc_mutation_idempotency
for select to authenticated
using ((select poc_private.has_workspace_access(workspace_id)));

create policy poc_audit_read on public.poc_audit_log
for select to authenticated
using ((select poc_private.has_workspace_access(workspace_id)));

revoke all on table public.poc_workspaces from public, anon, authenticated;
revoke all on table public.poc_workspace_members from public, anon, authenticated;
revoke all on table public.poc_members from public, anon, authenticated;
revoke all on table public.poc_attendance from public, anon, authenticated;
revoke all on table public.poc_mutation_idempotency from public, anon, authenticated;
revoke all on table public.poc_audit_log from public, anon, authenticated;

grant select on table public.poc_workspaces to authenticated;
grant select on table public.poc_workspace_members to authenticated;
grant select on table public.poc_members to authenticated;
grant select on table public.poc_attendance to authenticated;
grant select on table public.poc_mutation_idempotency to authenticated;
grant select on table public.poc_audit_log to authenticated;

create or replace function poc_private.require_workspace_access(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not poc_private.has_workspace_access(p_workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function poc_private.require_workspace_access(uuid) from public, anon;
grant execute on function poc_private.require_workspace_access(uuid) to authenticated;

create or replace function poc_private.payload_hash(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.md5(coalesce(p_payload, '{}'::jsonb)::text);
$$;

revoke all on function poc_private.payload_hash(jsonb) from public, anon, authenticated;

create or replace function public.poc_create_workspace(
  p_name text,
  p_workspace_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_workspace public.poc_workspaces%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_workspace_id is null or btrim(coalesce(p_name, '')) = '' then
    raise exception 'Workspace id and name are required' using errcode = '22023';
  end if;

  insert into public.poc_workspaces (id, name, created_by)
  values (p_workspace_id, btrim(p_name), v_actor)
  returning * into v_workspace;

  insert into public.poc_workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_actor, 'owner');

  return jsonb_build_object('success', true, 'workspace', to_jsonb(v_workspace));
end;
$$;

create or replace function public.poc_add_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text default 'collaborator'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_is_owner boolean;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select exists (
    select 1 from public.poc_workspace_members
    where workspace_id = p_workspace_id and user_id = v_actor and role = 'owner'
  ) into v_is_owner;
  if not v_is_owner then
    raise exception 'Workspace owner access required' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'collaborator') then
    raise exception 'Invalid workspace role' using errcode = '22023';
  end if;

  insert into public.poc_workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_user_id, p_role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  return jsonb_build_object('success', true, 'workspace_id', p_workspace_id, 'user_id', p_user_id, 'role', p_role);
end;
$$;

create or replace function public.poc_create_member(
  p_workspace_id uuid,
  p_member_id uuid,
  p_full_name text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_hash text;
  v_prior public.poc_mutation_idempotency%rowtype;
  v_member public.poc_members%rowtype;
  v_result jsonb;
begin
  v_actor := poc_private.require_workspace_access(p_workspace_id);
  if p_member_id is null or btrim(coalesce(p_full_name, '')) = '' or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'Member id, name, and request id are required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_request_id, 0));
  v_hash := poc_private.payload_hash(jsonb_build_object('member_id', p_member_id, 'full_name', btrim(p_full_name)));
  select * into v_prior from public.poc_mutation_idempotency
  where workspace_id = p_workspace_id and request_id = p_request_id;
  if found then
    if v_prior.operation <> 'create_member' or v_prior.payload_hash <> v_hash then
      raise exception 'Request id was already used with a different mutation' using errcode = '22023';
    end if;
    return v_prior.result;
  end if;

  insert into public.poc_members (id, workspace_id, full_name, updated_by)
  values (p_member_id, p_workspace_id, btrim(p_full_name), v_actor)
  returning * into v_member;

  v_result := jsonb_build_object('success', true, 'save_state', 'SERVER_CONFIRMED', 'member', to_jsonb(v_member));
  insert into public.poc_audit_log (workspace_id, actor_id, request_id, operation, entity_type, entity_id, after_state)
  values (p_workspace_id, v_actor, p_request_id, 'create_member', 'member', p_member_id::text, to_jsonb(v_member));
  insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
  values (p_workspace_id, p_request_id, 'create_member', v_hash, v_result, v_actor);
  return v_result;
end;
$$;

create or replace function public.poc_update_member(
  p_workspace_id uuid,
  p_member_id uuid,
  p_full_name text,
  p_expected_revision bigint,
  p_request_id text,
  p_simulate_failure boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_hash text;
  v_prior public.poc_mutation_idempotency%rowtype;
  v_before public.poc_members%rowtype;
  v_after public.poc_members%rowtype;
  v_result jsonb;
begin
  v_actor := poc_private.require_workspace_access(p_workspace_id);
  if p_member_id is null or btrim(coalesce(p_full_name, '')) = '' or p_expected_revision is null or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'Member id, name, expected revision, and request id are required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_request_id, 0));
  v_hash := poc_private.payload_hash(jsonb_build_object('member_id', p_member_id, 'full_name', btrim(p_full_name), 'expected_revision', p_expected_revision));
  select * into v_prior from public.poc_mutation_idempotency
  where workspace_id = p_workspace_id and request_id = p_request_id;
  if found then
    if v_prior.operation <> 'update_member' or v_prior.payload_hash <> v_hash then
      raise exception 'Request id was already used with a different mutation' using errcode = '22023';
    end if;
    return v_prior.result;
  end if;

  select * into v_before from public.poc_members
  where id = p_member_id and workspace_id = p_workspace_id
  for update;
  if not found or v_before.is_deleted then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if v_before.revision <> p_expected_revision then
    v_result := jsonb_build_object('success', false, 'conflict', true, 'save_state', 'CONFLICT', 'member', to_jsonb(v_before));
    insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
    values (p_workspace_id, p_request_id, 'update_member', v_hash, v_result, v_actor);
    return v_result;
  end if;

  update public.poc_members
  set full_name = btrim(p_full_name), revision = revision + 1, updated_by = v_actor, updated_at = clock_timestamp()
  where id = p_member_id and workspace_id = p_workspace_id
  returning * into v_after;

  insert into public.poc_audit_log (workspace_id, actor_id, request_id, operation, entity_type, entity_id, before_state, after_state)
  values (p_workspace_id, v_actor, p_request_id, 'update_member', 'member', p_member_id::text, to_jsonb(v_before), to_jsonb(v_after));

  if p_simulate_failure then
    raise exception 'POC_SIMULATED_TRANSACTION_FAILURE' using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object('success', true, 'save_state', 'SERVER_CONFIRMED', 'member', to_jsonb(v_after));
  insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
  values (p_workspace_id, p_request_id, 'update_member', v_hash, v_result, v_actor);
  return v_result;
end;
$$;

create or replace function public.poc_set_attendance(
  p_workspace_id uuid,
  p_member_id uuid,
  p_attendance_id uuid,
  p_attendance_date date,
  p_status text,
  p_expected_revision bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_hash text;
  v_prior public.poc_mutation_idempotency%rowtype;
  v_before public.poc_attendance%rowtype;
  v_after public.poc_attendance%rowtype;
  v_result jsonb;
begin
  v_actor := poc_private.require_workspace_access(p_workspace_id);
  if p_member_id is null or p_attendance_id is null or p_attendance_date is null or p_status not in ('present', 'absent') or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'Member, attendance id, date, valid status, and request id are required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.poc_members where id = p_member_id and workspace_id = p_workspace_id and not is_deleted) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_request_id, 0));
  v_hash := poc_private.payload_hash(jsonb_build_object('member_id', p_member_id, 'attendance_id', p_attendance_id, 'attendance_date', p_attendance_date, 'status', p_status, 'expected_revision', p_expected_revision));
  select * into v_prior from public.poc_mutation_idempotency where workspace_id = p_workspace_id and request_id = p_request_id;
  if found then
    if v_prior.operation <> 'set_attendance' or v_prior.payload_hash <> v_hash then
      raise exception 'Request id was already used with a different mutation' using errcode = '22023';
    end if;
    return v_prior.result;
  end if;

  select * into v_before from public.poc_attendance
  where workspace_id = p_workspace_id and member_id = p_member_id and attendance_date = p_attendance_date
  for update;
  if found and p_expected_revision is distinct from v_before.revision then
    v_result := jsonb_build_object('success', false, 'conflict', true, 'save_state', 'CONFLICT', 'attendance', to_jsonb(v_before));
    insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
    values (p_workspace_id, p_request_id, 'set_attendance', v_hash, v_result, v_actor);
    return v_result;
  end if;
  if not found and p_expected_revision is not null then
    v_result := jsonb_build_object('success', false, 'conflict', true, 'save_state', 'CONFLICT', 'attendance', null);
    insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
    values (p_workspace_id, p_request_id, 'set_attendance', v_hash, v_result, v_actor);
    return v_result;
  end if;

  insert into public.poc_attendance (id, workspace_id, member_id, attendance_date, status, updated_by)
  values (p_attendance_id, p_workspace_id, p_member_id, p_attendance_date, p_status, v_actor)
  on conflict (workspace_id, member_id, attendance_date) do update
  set status = excluded.status,
      is_deleted = false,
      revision = public.poc_attendance.revision + 1,
      updated_by = excluded.updated_by,
      updated_at = clock_timestamp()
  returning * into v_after;

  v_result := jsonb_build_object('success', true, 'save_state', 'SERVER_CONFIRMED', 'attendance', to_jsonb(v_after));
  insert into public.poc_audit_log (workspace_id, actor_id, request_id, operation, entity_type, entity_id, before_state, after_state)
  values (p_workspace_id, v_actor, p_request_id, 'set_attendance', 'attendance', v_after.id::text, case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_after));
  insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
  values (p_workspace_id, p_request_id, 'set_attendance', v_hash, v_result, v_actor);
  return v_result;
end;
$$;

create or replace function public.poc_clear_attendance(
  p_workspace_id uuid,
  p_member_id uuid,
  p_attendance_id uuid,
  p_attendance_date date,
  p_expected_revision bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_hash text;
  v_prior public.poc_mutation_idempotency%rowtype;
  v_before public.poc_attendance%rowtype;
  v_after public.poc_attendance%rowtype;
  v_result jsonb;
begin
  v_actor := poc_private.require_workspace_access(p_workspace_id);
  if p_member_id is null or p_attendance_id is null or p_attendance_date is null or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'Member, attendance id, date, and request id are required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_request_id, 0));
  v_hash := poc_private.payload_hash(jsonb_build_object('member_id', p_member_id, 'attendance_id', p_attendance_id, 'attendance_date', p_attendance_date, 'expected_revision', p_expected_revision));
  select * into v_prior from public.poc_mutation_idempotency where workspace_id = p_workspace_id and request_id = p_request_id;
  if found then
    if v_prior.operation <> 'clear_attendance' or v_prior.payload_hash <> v_hash then
      raise exception 'Request id was already used with a different mutation' using errcode = '22023';
    end if;
    return v_prior.result;
  end if;

  select * into v_before from public.poc_attendance
  where workspace_id = p_workspace_id and member_id = p_member_id and attendance_date = p_attendance_date
  for update;
  if not found and p_expected_revision is not null then
    v_result := jsonb_build_object('success', false, 'conflict', true, 'save_state', 'CONFLICT', 'attendance', null);
    insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
    values (p_workspace_id, p_request_id, 'clear_attendance', v_hash, v_result, v_actor);
    return v_result;
  end if;
  if found and p_expected_revision is distinct from v_before.revision then
    v_result := jsonb_build_object('success', false, 'conflict', true, 'save_state', 'CONFLICT', 'attendance', to_jsonb(v_before));
    insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
    values (p_workspace_id, p_request_id, 'clear_attendance', v_hash, v_result, v_actor);
    return v_result;
  end if;

  if found then
    update public.poc_attendance
    set status = null, is_deleted = true, revision = revision + 1, updated_by = v_actor, updated_at = clock_timestamp()
    where id = v_before.id
    returning * into v_after;
  else
    insert into public.poc_attendance (id, workspace_id, member_id, attendance_date, status, updated_by, is_deleted)
    values (p_attendance_id, p_workspace_id, p_member_id, p_attendance_date, null, v_actor, true)
    returning * into v_after;
  end if;

  v_result := jsonb_build_object('success', true, 'save_state', 'SERVER_CONFIRMED', 'attendance', to_jsonb(v_after));
  insert into public.poc_audit_log (workspace_id, actor_id, request_id, operation, entity_type, entity_id, before_state, after_state)
  values (p_workspace_id, v_actor, p_request_id, 'clear_attendance', 'attendance', v_after.id::text, case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_after));
  insert into public.poc_mutation_idempotency (workspace_id, request_id, operation, payload_hash, result, actor_id)
  values (p_workspace_id, p_request_id, 'clear_attendance', v_hash, v_result, v_actor);
  return v_result;
end;
$$;

create or replace function public.poc_pull_changes(
  p_workspace_id uuid,
  p_entity text,
  p_checkpoint_updated_at timestamptz default null,
  p_checkpoint_id text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_documents jsonb := '[]'::jsonb;
  v_checkpoint jsonb := null;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  v_actor := poc_private.require_workspace_access(p_workspace_id);
  if p_entity = 'members' then
    with rows as (
      select m.* from public.poc_members m
      where m.workspace_id = p_workspace_id
        and (p_checkpoint_updated_at is null
          or m.updated_at > p_checkpoint_updated_at
          or (m.updated_at = p_checkpoint_updated_at and m.id::text > coalesce(p_checkpoint_id, '')))
      order by m.updated_at, m.id
      limit v_limit
    )
    select coalesce(jsonb_agg(to_jsonb(rows) order by updated_at, id), '[]'::jsonb),
           (select jsonb_build_object('updated_at', updated_at, 'id', id::text) from rows order by updated_at desc, id desc limit 1)
    into v_documents, v_checkpoint from rows;
  elsif p_entity = 'attendance' then
    with rows as (
      select a.* from public.poc_attendance a
      where a.workspace_id = p_workspace_id
        and (p_checkpoint_updated_at is null
          or a.updated_at > p_checkpoint_updated_at
          or (a.updated_at = p_checkpoint_updated_at and a.id::text > coalesce(p_checkpoint_id, '')))
      order by a.updated_at, a.id
      limit v_limit
    )
    select coalesce(jsonb_agg(to_jsonb(rows) order by updated_at, id), '[]'::jsonb),
           (select jsonb_build_object('updated_at', updated_at, 'id', id::text) from rows order by updated_at desc, id desc limit 1)
    into v_documents, v_checkpoint from rows;
  else
    raise exception 'Unsupported POC replication entity' using errcode = '22023';
  end if;
  return jsonb_build_object('documents', v_documents, 'checkpoint', v_checkpoint);
end;
$$;

revoke all on function public.poc_create_workspace(text, uuid) from public, anon;
revoke all on function public.poc_add_workspace_member(uuid, uuid, text) from public, anon;
revoke all on function public.poc_create_member(uuid, uuid, text, text) from public, anon;
revoke all on function public.poc_update_member(uuid, uuid, text, bigint, text, boolean) from public, anon;
revoke all on function public.poc_set_attendance(uuid, uuid, uuid, date, text, bigint, text) from public, anon;
revoke all on function public.poc_clear_attendance(uuid, uuid, uuid, date, bigint, text) from public, anon;
revoke all on function public.poc_pull_changes(uuid, text, timestamptz, text, integer) from public, anon;

grant execute on function public.poc_create_workspace(text, uuid) to authenticated;
grant execute on function public.poc_add_workspace_member(uuid, uuid, text) to authenticated;
grant execute on function public.poc_create_member(uuid, uuid, text, text) to authenticated;
grant execute on function public.poc_update_member(uuid, uuid, text, bigint, text, boolean) to authenticated;
grant execute on function public.poc_set_attendance(uuid, uuid, uuid, date, text, bigint, text) to authenticated;
grant execute on function public.poc_clear_attendance(uuid, uuid, uuid, date, bigint, text) to authenticated;
grant execute on function public.poc_pull_changes(uuid, text, timestamptz, text, integer) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'poc_members'
  ) then
    alter publication supabase_realtime add table public.poc_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'poc_attendance'
  ) then
    alter publication supabase_realtime add table public.poc_attendance;
  end if;
end;
$$;

notify pgrst, 'reload schema';
