-- Server-side allowlist for Member V2 workspace mutations. No workspace is
-- enabled by this migration; operators must explicitly add an eligible owner
-- after a separate rollout decision.
create table if not exists public.member_v2_rollout_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.member_v2_rollout_workspaces enable row level security;
revoke all on public.member_v2_rollout_workspaces from public, anon, authenticated;
grant select, insert, update, delete on public.member_v2_rollout_workspaces to service_role;

create or replace function public.member_v2_require_rollout_enabled(p_owner_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if not exists (
    select 1 from public.member_v2_rollout_workspaces
    where owner_id = p_owner_id and enabled
  ) then
    raise exception 'Member V2 mutations are not enabled for this workspace' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.member_v2_reserve_mutation(
  p_request_id text,
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid,
  p_operation_name text,
  p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_existing public.member_v2_mutations%rowtype;
begin
  perform public.member_v2_require_rollout_enabled(p_owner_id);
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'Request id is required' using errcode = '22023';
  end if;
  select * into v_existing from public.member_v2_mutations where request_id = p_request_id for update;
  if found then
    if v_existing.owner_id <> p_owner_id
       or v_existing.table_name <> p_table_name
       or v_existing.member_id <> p_member_id
       or v_existing.operation_name <> p_operation_name
       or v_existing.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'Request id was already used for a different member mutation' using errcode = '22023';
    end if;
    if v_existing.response is not null then
      return jsonb_build_object(
        'reserved', false,
        'response', v_existing.response || jsonb_build_object('status', 'IDEMPOTENT_REPLAY', 'original_status', v_existing.status)
      );
    end if;
    return jsonb_build_object('reserved', false, 'response', jsonb_build_object('status', 'IN_PROGRESS', 'request_id', p_request_id));
  end if;
  insert into public.member_v2_mutations(
    request_id, owner_id, table_name, member_id, operation_name, payload_fingerprint, status, created_by
  ) values (
    p_request_id, p_owner_id, p_table_name, p_member_id, p_operation_name, p_payload_fingerprint, 'PROCESSING', auth.uid()
  );
  return jsonb_build_object('reserved', true);
end;
$$;

revoke all on function public.member_v2_require_rollout_enabled(uuid) from public, anon, authenticated;
revoke all on function public.member_v2_reserve_mutation(text,uuid,text,uuid,text,text) from public, anon, authenticated;

notify pgrst, 'reload schema';
