-- Quick Sunday List: deliberately narrow attendance-only write.
-- This is additive and is intentionally NOT the broader cross-month import
-- RPC: it cannot create/import a member, allocate a code, or edit a profile.

create function public.set_workspace_month_member_attendance(
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
    -- Existing active member only. No insert, no restoration, and no source-month lookup.
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

revoke all on function public.set_workspace_month_member_attendance(uuid, date, uuid, date, text, text) from public, anon;
grant execute on function public.set_workspace_month_member_attendance(uuid, date, uuid, date, text, text) to authenticated;
