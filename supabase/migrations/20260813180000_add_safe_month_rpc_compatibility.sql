-- Migration: Add Safe Month RPC Compatibility
-- Provides standalone, server-controlled logical month endpoints:
-- 1. create_workspace_month: creates a new month table from a logical source month or initial empty state without caller-controlled DDL.
-- 2. set_member_attendance_from_logical_month: marks/clears attendance across logical months without client-provided table names.
--
-- Security & Provenance Model:
-- - Rejects anonymous sessions explicitly via auth.jwt()->>'is_anonymous' and auth.uid() checks.
-- - Strictly scopes workspace provenance to immutable workspace_owner_id = p_owner_id (no user_id ownership fallback).
-- - Validates canonical table format (to_char(date, 'FMMonth_YYYY')) server-side.
-- - Resets attendance on copy-forward (only copies member profile attributes, all Sundays initialize to NULL).
-- - Supports initial/empty month creation when p_source_month is NULL or p_copy_mode = 'empty'.
-- - Uses member_mutation_idempotency.completed_at (matching live schema).
-- - Backward compatibility: keeps legacy create_month_from_current and set_member_attendance_from_other_month untouched.

-- Helper: check if a column exists on a table safely
create or replace function public.month_table_column_exists_safe(p_table text, p_col text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table
      and column_name = p_col
  );
$$;

revoke all on function public.month_table_column_exists_safe(text, text) from public, anon;
grant execute on function public.month_table_column_exists_safe(text, text) to authenticated;

-- 1. create_workspace_month
create or replace function public.create_workspace_month(
  p_owner_id uuid,
  p_year integer,
  p_month integer,
  p_source_month date default null,
  p_copy_mode text default 'empty',
  p_member_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_requester_id uuid;
  v_target_month date;
  v_target text;
  v_source text;
  v_copied integer := 0;
  v_target_exists boolean;
  v_source_exists boolean;
  v_source_has_deleted boolean;
  v_source_has_owner boolean;
  v_sunday date;
  v_col_name text;
  v_profile_cols text[];
  v_source_col_list text;
  v_target_col_list text;
  v_copy_sql text;
begin
  -- 1. Authentication: explicitly reject anonymous sessions
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or auth.jwt() ->> 'role' = 'anon'
  then
    raise exception 'Authentication required. Anonymous sessions are not permitted' using errcode = '42501';
  end if;

  -- 2. Workspace authorization
  v_requester_id := public.require_permanent_workspace_actor(p_owner_id, false);

  -- 3. Input validation
  if p_year not between 2000 and 2200 or p_month not between 1 and 12 then
    raise exception 'Invalid year or month' using errcode = '22023';
  end if;

  if coalesce(p_copy_mode, 'empty') not in ('all', 'custom', 'empty') then
    raise exception 'Invalid copy mode %', p_copy_mode using errcode = '22023';
  end if;

  if p_source_month is not null and p_source_month <> date_trunc('month', p_source_month)::date then
    raise exception 'A valid source logical month is required' using errcode = '22023';
  end if;

  -- 4. Derive logical month identifiers
  v_target_month := make_date(p_year, p_month, 1);
  v_target := to_char(v_target_month, 'FMMonth_YYYY');

  if v_target !~ '^[A-Z][a-z]+_[0-9]{4}$' then
    raise exception 'Invalid canonical target month identifier' using errcode = '22023';
  end if;

  -- 5. Check if target month is already registered for this workspace
  if exists (
    select 1 from public.user_month_tables
    where user_id = p_owner_id and table_name = v_target
  ) then
    raise exception 'Month % already exists for this workspace', v_target using errcode = '23505';
  end if;

  -- 6. Resolve source table if copying members
  if p_source_month is not null and coalesce(p_copy_mode, 'empty') <> 'empty' then
    v_source := to_char(p_source_month, 'FMMonth_YYYY');
    if v_source !~ '^[A-Z][a-z]+_[0-9]{4}$' then
      raise exception 'Invalid canonical source month identifier' using errcode = '22023';
    end if;
    v_source_exists := to_regclass(format('public.%I', v_source)) is not null;
    if not v_source_exists then
      raise exception 'Source month table % does not exist', v_source using errcode = '42P01';
    end if;
  end if;

  -- 7. Create target table if it does not physically exist
  v_target_exists := to_regclass(format('public.%I', v_target)) is not null;
  if not v_target_exists then
    if v_source_exists then
      execute format('create table public.%I (like public.%I including defaults including constraints)', v_target, v_source);
    else
      execute format(
        'create table public.%I (
          id uuid default gen_random_uuid() primary key,
          "Full Name" text,
          "Gender" text,
          "Phone Number" text,
          "Age" text,
          "Current Level" text,
          workspace text,
          user_id uuid,
          workspace_owner_id uuid,
          date_of_birth text,
          parent_name_1 text,
          parent_phone_1 text,
          parent_name_2 text,
          parent_phone_2 text,
          notes text,
          ministry text,
          is_visitor boolean default false,
          member_code text,
          inserted_at timestamptz default now(),
          updated_at timestamptz default now(),
          deleted_at timestamptz,
          "Member" text,
          "Regular" text,
          "Newcomer" text,
          "Manual Badge" text,
          "Badge Type" text,
          "Join Date" text,
          "Member Status" text,
          "Manual Badges" jsonb
        )',
        v_target
      );
    end if;

    execute format('alter table public.%I add column if not exists workspace_owner_id uuid', v_target);
    execute format('alter table public.%I enable row level security', v_target);

    -- Safe workspace policy based on immutable workspace ownership
    execute format(
      'create policy %I on public.%I for all to authenticated
       using (public.can_access_workspace(coalesce(workspace_owner_id, %L)))
       with check (public.can_access_workspace(coalesce(workspace_owner_id, %L)))',
      v_target || '_workspace_access', v_target, p_owner_id, p_owner_id
    );
  else
    -- Target physically exists: ensure workspace_owner_id column exists
    execute format('alter table public.%I add column if not exists workspace_owner_id uuid', v_target);
  end if;

  -- 8. Ensure standard attendance columns exist for all Sundays in the target month (all start with NULL)
  v_sunday := v_target_month;
  while date_trunc('month', v_sunday)::date = v_target_month loop
    if extract(isodow from v_sunday) = 7 then
      v_col_name := 'attendance_' || replace(v_sunday::text, '-', '_');
      execute format('alter table public.%I add column if not exists %I text', v_target, v_col_name);
    end if;
    v_sunday := v_sunday + interval '1 day';
  end loop;

  -- 9. Realtime publication
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_target
  ) then
    begin
      execute format('alter publication supabase_realtime add table public.%I', v_target);
    exception when others then null;
    end;
  end if;

  -- 10. Copy members if requested (profile columns ONLY, attendance is completely reset to NULL)
  if v_source_exists and coalesce(p_copy_mode, 'empty') <> 'empty' then
    v_source_has_deleted := public.month_table_column_exists_safe(v_source, 'deleted_at');
    v_source_has_owner := public.month_table_column_exists_safe(v_source, 'workspace_owner_id');

    if not v_source_has_owner then
      raise exception 'Source table lacks immutable workspace_owner_id' using errcode = '42703';
    end if;

    -- Build list of profile columns shared between source and target (excluding attendance and timestamps)
    select array_agg(c.column_name)
    into v_profile_cols
    from information_schema.columns c
    join information_schema.columns tc
      on tc.table_schema = 'public'
     and tc.table_name = v_target
     and tc.column_name = c.column_name
    where c.table_schema = 'public'
      and c.table_name = v_source
      and c.column_name not like 'attendance_%'
      and c.column_name not in ('id', 'user_id', 'workspace_owner_id', 'inserted_at', 'updated_at', 'deleted_at');

    v_source_col_list := '';
    v_target_col_list := '';
    if v_profile_cols is not null and array_length(v_profile_cols, 1) > 0 then
      select string_agg(format('%I', col), ', '), string_agg(format('s.%I', col), ', ')
      into v_target_col_list, v_source_col_list
      from unnest(v_profile_cols) as col;
      v_target_col_list := ', ' || v_target_col_list;
      v_source_col_list := ', ' || v_source_col_list;
    end if;

    if p_copy_mode = 'all' then
      v_copy_sql := format(
        'insert into public.%I (id, user_id, workspace_owner_id%s)
         select s.id, %L, %L%s
         from public.%I s
         where s.workspace_owner_id = %L%s
         on conflict (id) do nothing',
        v_target, v_target_col_list,
        p_owner_id, p_owner_id, v_source_col_list,
        v_source, p_owner_id,
        case when v_source_has_deleted then ' and s.deleted_at is null' else '' end
      );
      execute v_copy_sql;
      get diagnostics v_copied = row_count;
    elsif p_copy_mode = 'custom' and cardinality(p_member_ids) > 0 then
      v_copy_sql := format(
        'insert into public.%I (id, user_id, workspace_owner_id%s)
         select s.id, %L, %L%s
         from public.%I s
         where s.workspace_owner_id = %L and s.id = any($1)%s
         on conflict (id) do nothing',
        v_target, v_target_col_list,
        p_owner_id, p_owner_id, v_source_col_list,
        v_source, p_owner_id,
        case when v_source_has_deleted then ' and s.deleted_at is null' else '' end
      );
      execute v_copy_sql using p_member_ids;
      get diagnostics v_copied = row_count;
    end if;
  end if;

  -- 11. Register in user_month_tables
  insert into public.user_month_tables(user_id, table_name, month_year)
  values (p_owner_id, v_target, to_char(v_target_month, 'FMMonth YYYY'))
  on conflict (user_id, table_name) do update set month_year = excluded.month_year;

  return jsonb_build_object(
    'success', true,
    'table_name', v_target,
    'members_copied', v_copied
  );
end;
$$;

revoke all on function public.create_workspace_month(uuid, integer, integer, date, text, uuid[]) from public, anon;
grant execute on function public.create_workspace_month(uuid, integer, integer, date, text, uuid[]) to authenticated;


-- 2. set_member_attendance_from_logical_month
create or replace function public.set_member_attendance_from_logical_month(
  p_owner_id uuid,
  p_source_month date,
  p_target_month date,
  p_member_id uuid,
  p_attendance_date date,
  p_attendance_status text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_requester_id uuid;
  v_source text;
  v_target text;
  v_clean_status text;
  v_norm_status text;
  v_reserved text;
  v_existing jsonb;
  v_attendance_col text;
  v_source_member jsonb;
  v_target_exists boolean := false;
  v_target_deleted boolean := false;
  v_source_has_deleted boolean;
  v_source_has_owner boolean;
  v_target_has_deleted boolean;
  v_target_has_updated boolean;
  v_target_has_owner boolean;
  v_status text;
  v_final_member jsonb;
  v_response jsonb;
  v_code text := '';
begin
  -- 1. Authentication: explicitly reject anonymous sessions
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or auth.jwt() ->> 'role' = 'anon'
  then
    raise exception 'Authentication required. Anonymous sessions are not permitted' using errcode = '42501';
  end if;

  -- 2. Workspace authorization
  v_requester_id := public.require_permanent_workspace_actor(p_owner_id, false);

  -- 3. Parameter validation & normalization (supports Present, Absent, and Clear/NULL)
  v_clean_status := trim(coalesce(p_attendance_status, ''));
  if v_clean_status = '' or lower(v_clean_status) in ('clear', 'null') then
    v_norm_status := null;
  elsif lower(v_clean_status) = 'present' then
    v_norm_status := 'Present';
  elsif lower(v_clean_status) = 'absent' then
    v_norm_status := 'Absent';
  else
    raise exception 'Invalid attendance status %. Allowed values are Present, Absent, or Clear/NULL', p_attendance_status using errcode = '22023';
  end if;

  if p_source_month is null or p_source_month <> date_trunc('month', p_source_month)::date then
    raise exception 'Source logical month is invalid' using errcode = '22023';
  end if;

  if p_target_month is null or p_target_month <> date_trunc('month', p_target_month)::date then
    raise exception 'Target logical month is invalid' using errcode = '22023';
  end if;

  if p_member_id is null then
    raise exception 'Member id is required' using errcode = '22023';
  end if;

  if p_attendance_date is null or date_trunc('month', p_attendance_date)::date <> p_target_month then
    raise exception 'Attendance date % does not belong to target month', p_attendance_date using errcode = '22023';
  end if;

  if p_request_id is null or nullif(btrim(p_request_id), '') is null then
    raise exception 'Request id is required' using errcode = '22023';
  end if;

  -- 4. Derive physical table names from logical months
  v_source := to_char(p_source_month, 'FMMonth_YYYY');
  v_target := to_char(p_target_month, 'FMMonth_YYYY');

  if v_source !~ '^[A-Z][a-z]+_[0-9]{4}$' or v_target !~ '^[A-Z][a-z]+_[0-9]{4}$' then
    raise exception 'Invalid canonical month identifier' using errcode = '22023';
  end if;

  if to_regclass(format('public.%I', v_source)) is null then
    raise exception 'Source month table % does not exist', v_source using errcode = '42P01';
  end if;

  if to_regclass(format('public.%I', v_target)) is null then
    raise exception 'Target month table % does not exist', v_target using errcode = '42P01';
  end if;

  -- 5. Idempotency reservation (using completed_at matching live schema)
  insert into public.member_mutation_idempotency(
    owner_id, table_name, operation_name, request_id, created_by, status, response
  ) values (
    p_owner_id, v_target, 'set_member_attendance_from_logical_month', p_request_id, v_requester_id, 'processing', null
  )
  on conflict (owner_id, table_name, operation_name, request_id) do nothing
  returning request_id into v_reserved;

  if v_reserved is null then
    select m.response into v_existing
    from public.member_mutation_idempotency m
    where m.owner_id = p_owner_id
      and m.table_name = v_target
      and m.operation_name = 'set_member_attendance_from_logical_month'
      and m.request_id = p_request_id;

    if v_existing is not null then
      return v_existing;
    end if;

    return jsonb_build_object(
      'success', false,
      'error_message', 'Duplicate request is still processing'
    );
  end if;

  begin
    -- 6. Construct attendance column name & ensure column exists
    v_attendance_col := 'attendance_' || replace(p_attendance_date::text, '-', '_');
    execute format('alter table public.%I add column if not exists %I text', v_target, v_attendance_col);

    -- 7. Fetch ACTIVE source member row via immutable workspace_owner_id
    v_source_has_deleted := public.month_table_column_exists_safe(v_source, 'deleted_at');
    v_source_has_owner := public.month_table_column_exists_safe(v_source, 'workspace_owner_id');

    if not v_source_has_owner then
      raise exception 'Source table lacks immutable workspace_owner_id' using errcode = '42703';
    end if;

    execute format(
      'select to_jsonb(s.*) from public.%I s where s.id = $1 and s.workspace_owner_id = $2%s limit 1',
      v_source,
      case when v_source_has_deleted then ' and s.deleted_at is null' else '' end
    ) into v_source_member using p_member_id, p_owner_id;

    if v_source_member is null then
      raise exception 'Active member % is not present in source month % for this workspace', p_member_id, v_source;
    end if;

    -- 8. Check if member already exists in target table for this workspace
    v_target_has_deleted := public.month_table_column_exists_safe(v_target, 'deleted_at');
    v_target_has_updated := public.month_table_column_exists_safe(v_target, 'updated_at');
    v_target_has_owner := public.month_table_column_exists_safe(v_target, 'workspace_owner_id');

    if not v_target_has_owner then
      execute format('alter table public.%I add column if not exists workspace_owner_id uuid', v_target);
      v_target_has_owner := true;
    end if;

    execute format('select exists(select 1 from public.%I t where t.id = $1 and t.workspace_owner_id = $2)', v_target)
      into v_target_exists using p_member_id, p_owner_id;

    if v_target_exists then
      if v_target_has_deleted then
        execute format('select exists(select 1 from public.%I t where t.id = $1 and t.workspace_owner_id = $2 and t.deleted_at is not null)', v_target)
          into v_target_deleted using p_member_id, p_owner_id;
      end if;

      execute format(
        'update public.%I set %I = $1%s%s where id = $2 and workspace_owner_id = $3',
        v_target, v_attendance_col,
        case when v_target_deleted then ', deleted_at = null' else '' end,
        case when v_target_has_updated then ', updated_at = now()' else '' end
      ) using v_norm_status, p_member_id, p_owner_id;

      v_status := case when v_target_deleted then 'restored' else 'already_present_in_month' end;
    else
      -- Insert new row in target table stamped with immutable workspace_owner_id
      execute format(
        'insert into public.%I (id, user_id, workspace_owner_id, %I) values ($1, $2, $2, $3) on conflict (id) do nothing',
        v_target,
        v_attendance_col
      ) using p_member_id, p_owner_id, v_norm_status;

      -- Copy shared profile attributes if they exist
      if public.month_table_column_exists_safe(v_source, 'Full Name') and public.month_table_column_exists_safe(v_target, 'Full Name') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'Full Name') using v_source_member->>'Full Name', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'Gender') and public.month_table_column_exists_safe(v_target, 'Gender') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'Gender') using v_source_member->>'Gender', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'Phone Number') and public.month_table_column_exists_safe(v_target, 'Phone Number') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'Phone Number') using v_source_member->>'Phone Number', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'Age') and public.month_table_column_exists_safe(v_target, 'Age') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'Age') using v_source_member->>'Age', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'Current Level') and public.month_table_column_exists_safe(v_target, 'Current Level') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'Current Level') using v_source_member->>'Current Level', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'date_of_birth') and public.month_table_column_exists_safe(v_target, 'date_of_birth') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'date_of_birth') using v_source_member->>'date_of_birth', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'parent_name_1') and public.month_table_column_exists_safe(v_target, 'parent_name_1') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'parent_name_1') using v_source_member->>'parent_name_1', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'parent_phone_1') and public.month_table_column_exists_safe(v_target, 'parent_phone_1') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'parent_phone_1') using v_source_member->>'parent_phone_1', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'parent_name_2') and public.month_table_column_exists_safe(v_target, 'parent_name_2') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'parent_name_2') using v_source_member->>'parent_name_2', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'parent_phone_2') and public.month_table_column_exists_safe(v_target, 'parent_phone_2') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'parent_phone_2') using v_source_member->>'parent_phone_2', p_member_id, p_owner_id;
      end if;
      if public.month_table_column_exists_safe(v_source, 'notes') and public.month_table_column_exists_safe(v_target, 'notes') then
        execute format('update public.%I set %I = $1 where id = $2 and workspace_owner_id = $3', v_target, 'notes') using v_source_member->>'notes', p_member_id, p_owner_id;
      end if;

      v_status := 'imported_and_present';
    end if;

    -- 9. Fetch assigned member code if present
    select current_code into v_code
    from public.workspace_member_codes
    where workspace_owner_id = p_owner_id and member_id = p_member_id
    limit 1;

    -- 10. Fetch final member row from target table
    execute format('select to_jsonb(t.*) from public.%I t where t.id = $1 and t.workspace_owner_id = $2', v_target)
      into v_final_member using p_member_id, p_owner_id;

    v_response := jsonb_build_object(
      'success', true,
      'status', v_status,
      'member_id', p_member_id,
      'member', v_final_member,
      'member_code', coalesce(v_code, ''),
      'source_month', p_source_month,
      'target_month', p_target_month,
      'attendance_date', p_attendance_date,
      'attendance_status', v_norm_status,
      'request_id', p_request_id
    );
  exception when others then
    v_response := jsonb_build_object(
      'success', false,
      'status', 'error',
      'error_message', sqlerrm,
      'request_id', p_request_id
    );
  end;

  -- 11. Complete idempotency reservation using completed_at (matching live schema)
  update public.member_mutation_idempotency
  set response = v_response,
      status = case when coalesce((v_response->>'success')::boolean, false) then 'success' else 'failed' end,
      error_message = case when coalesce((v_response->>'success')::boolean, false) then null else v_response->>'error_message' end,
      completed_at = now()
  where owner_id = p_owner_id
    and table_name = v_target
    and operation_name = 'set_member_attendance_from_logical_month'
    and request_id = p_request_id;

  return v_response;
end;
$$;

revoke all on function public.set_member_attendance_from_logical_month(uuid, date, date, uuid, date, text, text) from public, anon;
grant execute on function public.set_member_attendance_from_logical_month(uuid, date, date, uuid, date, text, text) to authenticated;
