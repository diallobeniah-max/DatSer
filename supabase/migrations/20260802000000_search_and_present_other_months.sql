-- Migration: Cross-Month Member Search and Safe Attendance/Import RPCs (Fix Ambiguous Column References)
-- Corrects public.add_attendance_column and qualifies all column references with table aliases.

-- 1. Fix add_attendance_column ambiguity
-- Keeps the committed signature add_attendance_column(text,text) RETURNS boolean so
-- existing callers (which use PERFORM and discard the result) remain compatible.
create or replace function public.add_attendance_column(
  table_name text,
  column_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = $1
      and c.column_name = $2
  ) then
    return true;
  end if;

  v_sql := format('alter table %I add column %I text default null;', $1, $2);

  begin
    execute v_sql;
    return true;
  exception when others then
    return false;
  end;
end;
$$;
revoke all on function public.add_attendance_column(text, text) from public, anon;
grant execute on function public.add_attendance_column(text, text) to authenticated;
-- 2. RPC: search_workspace_members_across_months
create or replace function public.search_workspace_members_across_months(
  p_owner_id uuid,
  p_current_table text,
  p_query text,
  p_limit integer default 30
)
returns table (
  canonical_member_id uuid,
  source_table text,
  source_month_label text,
  full_name text,
  gender text,
  phone_number text,
  age text,
  current_level text,
  parent_name_1 text,
  parent_phone_1 text,
  parent_name_2 text,
  parent_phone_2 text,
  notes text,
  ministry text,
  is_visitor boolean,
  date_of_birth text,
  member_code text,
  source_updated_at timestamptz,
  already_in_current_table boolean,
  is_deleted_in_current_table boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_clean_query text;
  v_clean_code text;
  v_clean_phone text;
  v_rec record;
  v_sql text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_current_valid boolean := false;
  v_tables_searched integer := 0;
  v_tables_failed integer := 0;
begin
  -- Enforce authorization
  perform public.authorize_workspace_actor(p_owner_id);

  if length(v_query) < 2 then
    return;
  end if;

  -- Validate current table if provided
  if p_current_table is not null and p_current_table <> '' then
    select exists (
      select 1
      from public.user_month_tables umt
      where umt.user_id = p_owner_id and umt.table_name = p_current_table
    ) into v_current_valid;

    if not v_current_valid then
      raise exception 'Current table % is not authorized for workspace owner %', p_current_table, p_owner_id;
    end if;
  end if;

  v_clean_query := lower(regexp_replace(v_query, '[^\w\s]', '', 'g'));
  v_clean_code := upper(regexp_replace(v_query, '[^A-Za-z0-9]', '', 'g'));
  v_clean_phone := regexp_replace(v_query, '\D', '', 'g');

  create temp table if not exists _tmp_cross_month_search_results (
    member_id uuid,
    tbl_name text,
    month_lbl text,
    m_name text,
    m_gender text,
    m_phone text,
    m_age text,
    m_level text,
    m_pname1 text,
    m_pphone1 text,
    m_pname2 text,
    m_pphone2 text,
    m_notes text,
    m_ministry text,
    m_visitor boolean,
    m_dob text,
    m_updated timestamptz,
    tbl_order integer,
    already_in_cur boolean default false,
    deleted_in_cur boolean default false
  ) on commit drop;

  delete from _tmp_cross_month_search_results;

  -- Iterate strictly through user_month_tables for p_owner_id
  for v_rec in (
    select umt.table_name, umt.month_year,
           row_number() over (order by umt.created_at desc, umt.id desc) as ord
    from public.user_month_tables umt
    where umt.user_id = p_owner_id
      and (p_current_table is null or p_current_table = '' or umt.table_name <> p_current_table)
    order by umt.created_at desc
  ) loop
    if not exists (
      select 1
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_name = v_rec.table_name
    ) then
      continue;
    end if;

    v_tables_searched := v_tables_searched + 1;

    v_sql := format(
      'insert into _tmp_cross_month_search_results (
         member_id, tbl_name, month_lbl, m_name, m_gender, m_phone, m_age,
         m_level, m_pname1, m_pphone1, m_pname2, m_pphone2, m_notes, m_ministry,
         m_visitor, m_dob, m_updated, tbl_order
       )
       select
         m.id,
         %L,
         %L,
         coalesce(m."Full Name", ''''),
         coalesce(m."Gender", ''''),
         coalesce(m."Phone Number", ''''),
         coalesce(m."Age", ''''),
         coalesce(m."Current Level", ''''),
         coalesce(m.parent_name_1, ''''),
         coalesce(m.parent_phone_1, ''''),
         coalesce(m.parent_name_2, ''''),
         coalesce(m.parent_phone_2, ''''),
         coalesce(m.notes, ''''),
         coalesce(m.ministry, ''''),
         coalesce(m.is_visitor, false),
         coalesce(m.date_of_birth, ''''),
         coalesce(m.inserted_at, now()),
         %L
       from %I m
       left join public.workspace_member_codes wmc
         on wmc.workspace_owner_id = %L and wmc.member_id = m.id
       where (not public.month_table_column_exists(%1$L, ''deleted_at'') or m.deleted_at is null)
         and (%s)',
      v_rec.table_name,
      coalesce(v_rec.month_year, replace(v_rec.table_name, '_', ' ')),
      v_rec.ord,
      v_rec.table_name,
      p_owner_id,
      case
        when v_clean_code <> '' then format(
          'm."Full Name" ilike %1$L
           or (length(%2$L) >= 3 and regexp_replace(coalesce(m."Phone Number", ''''), ''\D'', '''', ''g'') ilike %3$L)
           or (length(%2$L) >= 3 and regexp_replace(coalesce(m.parent_phone_1, ''''), ''\D'', '''', ''g'') ilike %3$L)
           or (length(%2$L) >= 3 and regexp_replace(coalesce(m.parent_phone_2, ''''), ''\D'', '''', ''g'') ilike %3$L)
           or m.parent_name_1 ilike %1$L
           or m.parent_name_2 ilike %1$L
           or wmc.current_code ilike %4$L
           or wmc.legacy_code ilike %4$L
           or %5$L = any(wmc.aliases)',
          '%' || v_query || '%',
          v_clean_phone,
          '%' || v_clean_phone || '%',
          v_clean_code || '%',
          v_clean_code
        )
        else format('m."Full Name" ilike %1$L', '%' || v_query || '%')
      end
    );

    begin
      execute v_sql;
    exception when others then
      v_tables_failed := v_tables_failed + 1;
    end;
  end loop;

  if v_tables_searched > 0 and v_tables_failed = v_tables_searched then
    raise exception 'Failed to search workspace month tables due to database errors';
  end if;

  -- Flag records already in current table
  if v_current_valid then
    v_sql := format(
      'update _tmp_cross_month_search_results res
       set already_in_cur = true
       from %I cur
       where cur.id = res.member_id',
      p_current_table
    );
    begin
      execute v_sql;
    exception when others then null;
    end;

    if public.month_table_column_exists(p_current_table, 'deleted_at') then
      v_sql := format(
        'update _tmp_cross_month_search_results res
         set deleted_in_cur = (cur.deleted_at is not null)
         from %I cur
         where cur.id = res.member_id',
        p_current_table
      );
      begin
        execute v_sql;
      exception when others then null;
      end;
    end if;
  end if;

  return query
  with dedup as (
    select distinct on (r.member_id)
      r.member_id,
      r.tbl_name,
      r.month_lbl,
      r.m_name,
      r.m_gender,
      r.m_phone,
      r.m_age,
      r.m_level,
      r.m_pname1,
      r.m_pphone1,
      r.m_pname2,
      r.m_pphone2,
      r.m_notes,
      r.m_ministry,
      r.m_visitor,
      r.m_dob,
      r.m_updated,
      r.tbl_order,
      r.already_in_cur,
      r.deleted_in_cur
    from _tmp_cross_month_search_results r
    order by r.member_id, r.tbl_order asc
  )
  select
    d.member_id as canonical_member_id,
    d.tbl_name as source_table,
    d.month_lbl as source_month_label,
    d.m_name as full_name,
    d.m_gender as gender,
    d.m_phone as phone_number,
    d.m_age as age,
    d.m_level as current_level,
    d.m_pname1 as parent_name_1,
    d.m_pphone1 as parent_phone_1,
    d.m_pname2 as parent_name_2,
    d.m_pphone2 as parent_phone_2,
    d.m_notes as notes,
    d.m_ministry as ministry,
    d.m_visitor as is_visitor,
    d.m_dob as date_of_birth,
    coalesce(wmc.current_code, '') as member_code,
    d.m_updated as source_updated_at,
    d.already_in_cur as already_in_current_table,
    d.deleted_in_cur as is_deleted_in_current_table
  from dedup d
  left join public.workspace_member_codes wmc
    on wmc.workspace_owner_id = p_owner_id and wmc.member_id = d.member_id
  order by d.tbl_order asc, d.m_name asc
  limit v_limit;
end;
$$;
revoke all on function public.search_workspace_members_across_months(uuid, text, text, integer) from public, anon;
grant execute on function public.search_workspace_members_across_months(uuid, text, text, integer) to authenticated;
-- 3. RPC: set_member_attendance_from_other_month
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
  v_common_cols text[];
  v_c text;
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

    -- Compute column intersection between source and target tables using aliases c1 and c2
    select array_agg(c1.column_name order by c1.column_name)
    into v_common_cols
    from information_schema.columns c1
    join information_schema.columns c2 on c1.column_name = c2.column_name
    where c1.table_schema = 'public' and c1.table_name = p_source_table
      and c2.table_schema = 'public' and c2.table_name = p_target_table
      and c1.column_name not ilike 'attendance_%'
      and c1.column_name not in ('id', 'user_id', 'inserted_at', 'updated_at', 'deleted_at');

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
        -- Restoring soft deleted member: clear deleted_at, fill empty profile fields from source
        v_update_assigns := format('%I = $2', v_attendance_col);
        if v_has_deleted then
          v_update_assigns := v_update_assigns || ', deleted_at = null';
        end if;
        if v_has_updated then
          v_update_assigns := v_update_assigns || ', updated_at = now()';
        end if;

        if v_common_cols is not null then
          foreach v_c in array v_common_cols loop
            if v_c = 'is_visitor' then
              v_update_assigns := v_update_assigns || format(
                ', %I = coalesce(%I, (%L ->> %L)::boolean, false)',
                v_c, v_c, v_source_json::text, v_c
              );
            else
              v_update_assigns := v_update_assigns || format(
                ', %I = coalesce(nullif(%I, ''''), (%L ->> %L))',
                v_c, v_c, v_source_json::text, v_c
              );
            end if;
          end loop;
        end if;

        v_sql := format('update %I set %s where id = $1', p_target_table, v_update_assigns);
        execute v_sql using p_member_id, v_clean_status;
        v_status := 'restored';
      else
        -- Member active in target table: update attendance column only
        v_update_assigns := format('%I = $2', v_attendance_col);
        if v_has_updated then
          v_update_assigns := v_update_assigns || ', updated_at = now()';
        end if;
        v_sql := format('update %I set %s where id = $1', p_target_table, v_update_assigns);
        execute v_sql using p_member_id, v_clean_status;
        v_status := 'already_present_in_month';
      end if;
    else
      -- 7. Absent member: Dynamic column intersection INSERT
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

      if v_common_cols is not null then
        foreach v_c in array v_common_cols loop
          v_col_list := v_col_list || ', ' || quote_ident(v_c);
          if v_c = 'is_visitor' then
            v_val_list := v_val_list || format(', coalesce((%L ->> %L)::boolean, false)', v_source_json::text, v_c);
          else
            v_val_list := v_val_list || format(', (%L ->> %L)', v_source_json::text, v_c);
          end if;
        end loop;
      end if;

      v_sql := format('insert into %I (%s) values (%s)', p_target_table, v_col_list, v_val_list);
      execute v_sql using p_member_id, p_owner_id, v_clean_status;
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
notify pgrst, 'reload schema';
