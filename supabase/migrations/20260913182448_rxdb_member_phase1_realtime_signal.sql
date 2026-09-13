-- Phase 1 client wake-up signal.  This carries no member profile data: clients
-- use it only to schedule the trusted cursor-based pull RPC.
create table if not exists public.member_v2_realtime_signals (
  signal_id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  latest_server_revision bigint not null references public.member_v2_change_events(server_revision) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists member_v2_realtime_signals_owner_signal_idx
  on public.member_v2_realtime_signals(owner_id, signal_id);

alter table public.member_v2_realtime_signals enable row level security;

drop policy if exists "member v2 realtime signal read" on public.member_v2_realtime_signals;
create policy "member v2 realtime signal read" on public.member_v2_realtime_signals
  for select to authenticated using (public.has_permanent_workspace_access(owner_id));

revoke all on public.member_v2_realtime_signals from public, anon, authenticated;
grant select on public.member_v2_realtime_signals to authenticated;

-- Postgres Changes respects RLS.  The signal table deliberately contains only
-- the workspace owner and the newest revision, never member PII.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'member_v2_realtime_signals'
  ) then
    alter publication supabase_realtime add table public.member_v2_realtime_signals;
  end if;
end;
$$;

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

notify pgrst, 'reload schema';
