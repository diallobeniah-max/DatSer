-- Fix cross-month single member attendance function using parameterized dynamic JSON SQL
create or replace function public.set_member_attendance_from_other_month(
  p_owner_id uuid,
  p_source_table text,
  p_target_table text,
  p_member_id uuid,
  p_attendance_date date,
  p_attendance_status text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_id uuid;
  v_reserved_request_id text;
  v_existing_response jsonb;
  v_source_valid boolean := false;
  v_target_month_label text;
  v_date_month_str text;
  v_date_ym_str text;
  v_attendance_col text;
  v_source_json jsonb;
  v_target_exists boolean := false;
  v_target_deleted boolean := false;
  v_sql text;
  v_status text;
  v_assignment public.workspace_member_codes%rowtype;
  v_final_member jsonb;
  v_response jsonb;
  v_success boolean := false;
  v_error_message text;
  v_clean_status text := coalesce(trim(p_attendance_status), '');
  v_has_updated boolean := false;
  v_has_deleted boolean := false;
  v_col_rec record;
  v_col_expr text;
  v_col_list text;
  v_val_list text;
  v_update_assigns text := '';
begin
  v_requester_id := public.authorize_workspace_actor(p_owner_id);

  if v_clean_status <> 'Present' and v_clean_status <> 'Absent' then
    raise exception 'Invalid attendance status %. Allowed values are Present or Absent', p_attendance_status;
  end if;

  if p_source_table is null or p_source_table = '' or p_target_table is null or p_target_table = '' then
    raise exception 'Source and target table names are required';
  end if;

  if p_member_id is null then
    raise exception 'Member id is required';
  end if;

  if p_attendance_date is null then
    raise exception 'Attendance date is required';
  end if;

  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'Request id is required';
  end if;

  -- 1. Validate tables belong to workspace owner
  select exists (
    select 1
    from public.user_month_tables umt
    where umt.user_id = p_owner_id and umt.table_name = p_source_table
  ) into v_source_valid;

  select umt.month_year into v_target_month_label
  from public.user_month_tables umt
  where umt.user_id = p_owner_id and umt.table_name = p_target_table;

  if not v_source_valid then
    raise exception 'Source table % is not authorized for this workspace', p_source_table;
  end if;

  if v_target_month_label is null then
    raise exception 'Target table % is not authorized for this workspace', p_target_table;
  end if;

  -- 2. Validate p_attendance_date belongs to target month
  v_date_month_str := trim(to_char(p_attendance_date, 'FMMonth YYYY'));
  v_date_ym_str := to_char(p_attendance_date, 'YYYY-MM');

  if lower(replace(p_target_table, '_', ' ')) <> lower(v_date_month_str)
     and lower(v_target_month_label) <> lower(v_date_month_str)
     and lower(v_target_month_label) <> lower(v_date_ym_str)
     and lower(replace(v_target_month_label, '_', ' ')) <> lower(v_date_month_str)
  then
    raise exception 'Attendance date % (% ) does not belong to target month % (% )',
      p_attendance_date, v_date_month_str, p_target_table, v_target_month_label;
  end if;

  -- 3. Idempotency reservation (using alias m to prevent ambiguity)
  insert into public.member_mutation_idempotency (
    owner_id, table_name, operation_name, request_id, created_by, status, response
  ) values (
    p_owner_id, p_target_table, 'set_member_attendance_from_other_month', p_request_id, v_requester_id, 'processing', null
  )
  on conflict (owner_id, table_name, operation_name, request_id) do nothing
  returning request_id into v_reserved_request_id;

  if v_reserved_request_id is null then
    select m.response into v_existing_response
    from public.member_mutation_idempotency m
    where m.owner_id = p_owner_id
      and m.table_name = p_target_table
      and m.operation_name = 'set_member_attendance_from_other_month'
      and m.request_id = p_request_id;

    if v_existing_response is not null then
      return v_existing_response;
    end if;

    return jsonb_build_object(
      'success', false,
      'error_message', 'Duplicate request is still being processed'
    );
  end if;

  begin
    -- 4. Construct attendance column name & ensure it exists on target table
    v_attendance_col := 'attendance_' || replace(p_attendance_date::text, '-', '_');
    perform public.add_attendance_column(p_target_table, v_attendance_col);

    -- 5. Fetch ACTIVE source member record (deleted_at must be null if column exists)
    if public.month_table_column_exists(p_source_table, 'deleted_at') then
      v_sql := format('select to_jsonb(s.*) from %I s where s.id = $1 and s.deleted_at is null limit 1', p_source_table);
    else
      v_sql := format('select to_jsonb(s.*) from %I s where s.id = $1 limit 1', p_source_table);
    end if;
    execute v_sql into v_source_json using p_member_id;

    if v_source_json is null then
      raise exception 'Active member % not found in source table %', p_member_id, p_source_table;
    end if;

    -- Check column capabilities on target table
    select public.month_table_column_exists(p_target_table, 'updated_at') into v_has_updated;
    select public.month_table_column_exists(p_target_table, 'deleted_at') into v_has_deleted;

    -- 6. Check if member exists in target table
    v_sql := format(
      'select exists (select 1 from %I t where t.id = $1) as ex',
      p_target_table
    );
    execute v_sql into v_target_exists using p_member_id;

    if v_target_exists then
      if v_has_deleted then
        execute format('select exists (select 1 from %I t where t.id = $1 and t.deleted_at is not null)', p_target_table)
          into v_target_deleted using p_member_id;
      end if;

      if v_target_deleted then
        -- Restoring soft deleted member: clear deleted_at, fill empty profile fields from source using $4 ($4::jsonb)
        v_update_assigns := format('%I = $2', v_attendance_col);
        if v_has_deleted then
          v_update_assigns := v_update_assigns || ', deleted_at = null';
        end if;
        if v_has_updated then
          v_update_assigns := v_update_assigns || ', updated_at = now()';
        end if;

        for v_col_rec in
          select c1.column_name, c2.data_type, c2.udt_name
          from information_schema.columns c1
          join information_schema.columns c2 on c1.column_name = c2.column_name
          where c1.table_schema = 'public' and c1.table_name = p_source_table
            and c2.table_schema = 'public' and c2.table_name = p_target_table
            and c1.column_name not ilike 'attendance_%'
            and c1.column_name not in ('id', 'user_id', 'inserted_at', 'updated_at', 'deleted_at')
          order by c2.column_name
        loop
          if v_col_rec.data_type = 'boolean' then
            v_col_expr := format('coalesce(($4::jsonb ->> %L)::boolean, false)', v_col_rec.column_name);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(%I, %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          elsif v_col_rec.data_type in ('integer', 'smallint', 'bigint') then
            v_col_expr := format('(($4::jsonb ->> %L)::%I)', v_col_rec.column_name, v_col_rec.data_type);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(%I, %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          elsif v_col_rec.data_type = 'numeric' then
            v_col_expr := format('(($4::jsonb ->> %L)::numeric)', v_col_rec.column_name);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(%I, %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          elsif v_col_rec.data_type = 'date' then
            v_col_expr := format('(($4::jsonb ->> %L)::date)', v_col_rec.column_name);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(%I, %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          elsif v_col_rec.data_type like 'timestamp%' then
            v_col_expr := format('(($4::jsonb ->> %L)::timestamptz)', v_col_rec.column_name);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(%I, %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          elsif v_col_rec.data_type = 'jsonb' then
            v_col_expr := format('($4::jsonb -> %L)', v_col_rec.column_name);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(%I, %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          elsif v_col_rec.data_type = 'ARRAY' or v_col_rec.udt_name like '\_%' escape '\' then
            v_col_expr := format('(($4::jsonb ->> %L)::text[])', v_col_rec.column_name);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(%I, %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          else
            v_col_expr := format('($4::jsonb ->> %L)', v_col_rec.column_name);
            v_update_assigns := v_update_assigns || format(', %I = coalesce(nullif(%I, ''''), %s)', v_col_rec.column_name, v_col_rec.column_name, v_col_expr);
          end if;
        end loop;

        v_sql := format('update %I set %s where id = $1', p_target_table, v_update_assigns);
        execute v_sql using p_member_id, v_clean_status, p_owner_id, v_source_json;
        v_status := 'restored';
      else
        -- Member active in target table: update attendance column only
        v_update_assigns := format('%I = $2', v_attendance_col);
        if v_has_updated then
          v_update_assigns := v_update_assigns || ', updated_at = now()';
        end if;
        v_sql := format('update %I set %s where id = $1', p_target_table, v_update_assigns);
        execute v_sql using p_member_id, v_clean_status, p_owner_id, v_source_json;
        v_status := 'already_present_in_month';
      end if;
    else
      -- 7. Absent member: Dynamic column intersection INSERT using $4 ($4::jsonb)
      v_col_list := 'id, user_id, inserted_at, ' || quote_ident(v_attendance_col);
      v_val_list := '$1, $2, now(), $3';

      if v_has_updated then
        v_col_list := v_col_list || ', updated_at';
        v_val_list := v_val_list || ', now()';
      end if;

      if v_has_deleted then
        v_col_list := v_col_list || ', deleted_at';
        v_val_list := v_val_list || ', null';
      end if;

      for v_col_rec in
        select c1.column_name, c2.data_type, c2.udt_name
        from information_schema.columns c1
        join information_schema.columns c2 on c1.column_name = c2.column_name
        where c1.table_schema = 'public' and c1.table_name = p_source_table
          and c2.table_schema = 'public' and c2.table_name = p_target_table
          and c1.column_name not ilike 'attendance_%'
          and c1.column_name not in ('id', 'user_id', 'inserted_at', 'updated_at', 'deleted_at')
        order by c2.column_name
      loop
        v_col_list := v_col_list || ', ' || quote_ident(v_col_rec.column_name);
        if v_col_rec.data_type = 'boolean' then
          v_col_expr := format('coalesce(($4::jsonb ->> %L)::boolean, false)', v_col_rec.column_name);
        elsif v_col_rec.data_type in ('integer', 'smallint', 'bigint') then
          v_col_expr := format('(($4::jsonb ->> %L)::%I)', v_col_rec.column_name, v_col_rec.data_type);
        elsif v_col_rec.data_type = 'numeric' then
          v_col_expr := format('(($4::jsonb ->> %L)::numeric)', v_col_rec.column_name);
        elsif v_col_rec.data_type = 'date' then
          v_col_expr := format('(($4::jsonb ->> %L)::date)', v_col_rec.column_name);
        elsif v_col_rec.data_type like 'timestamp%' then
          v_col_expr := format('(($4::jsonb ->> %L)::timestamptz)', v_col_rec.column_name);
        elsif v_col_rec.data_type = 'jsonb' then
          v_col_expr := format('($4::jsonb -> %L)', v_col_rec.column_name);
        elsif v_col_rec.data_type = 'ARRAY' or v_col_rec.udt_name like '\_%' escape '\' then
          v_col_expr := format('(($4::jsonb ->> %L)::text[])', v_col_rec.column_name);
        else
          v_col_expr := format('($4::jsonb ->> %L)', v_col_rec.column_name);
        end if;
        v_val_list := v_val_list || ', ' || v_col_expr;
      end loop;

      v_sql := format('insert into %I (%s) values (%s)', p_target_table, v_col_list, v_val_list);
      execute v_sql using p_member_id, p_owner_id, v_clean_status, v_source_json;
      v_status := 'imported_and_present';
    end if;

    -- 8. Ensure canonical member code assignment in workspace_member_codes
    v_assignment := public.ensure_workspace_member_code(
      p_owner_id,
      jsonb_build_object('id', p_member_id)
    );

    -- 9. Fetch final member record from target table
    execute format('select to_jsonb(t.*) from %I t where t.id = $1', p_target_table)
      into v_final_member using p_member_id;

    v_success := true;
    v_response := jsonb_build_object(
      'success', true,
      'status', v_status,
      'member_id', p_member_id,
      'member', v_final_member,
      'member_code', v_assignment.current_code,
      'code_assignment', to_jsonb(v_assignment),
      'source_table', p_source_table,
      'target_table', p_target_table,
      'attendance_date', p_attendance_date,
      'attendance_status', v_clean_status,
      'request_id', p_request_id
    );
  exception when others then
    v_error_message := SQLERRM;
    v_response := jsonb_build_object(
      'success', false,
      'status', 'error',
      'error_message', v_error_message,
      'request_id', p_request_id
    );
  end;

  -- 10. Record final status in idempotency table
  update public.member_mutation_idempotency m
  set response = v_response,
      status = case when v_success then 'success' else 'failed' end,
      error_message = case when v_success then null else v_response->>'error_message' end,
      completed_at = now()
  where m.owner_id = p_owner_id
    and m.table_name = p_target_table
    and m.operation_name = 'set_member_attendance_from_other_month'
    and m.request_id = p_request_id;

  return v_response;
end;
$$;

revoke all on function public.set_member_attendance_from_other_month(uuid, text, text, uuid, date, text, text) from public, anon;
grant execute on function public.set_member_attendance_from_other_month(uuid, text, text, uuid, date, text, text) to authenticated;
