-- Preserve numeric legacy phone storage while safely copying into numeric or text month schemas.
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
revoke all on function public.set_member_attendance_from_other_month(uuid, date, date, uuid, date, text, text) from public, anon;
grant execute on function public.set_member_attendance_from_other_month(uuid, date, date, uuid, date, text, text) to authenticated;
notify pgrst, 'reload schema';
