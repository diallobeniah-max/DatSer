-- Migration: 20260807000000_fix_historical_search_delete_where.sql
-- Fixes production bug: pg-safeupdate rejects unqualified temp-table DELETEs
-- inside the historical-search RPCs with code 21000 "DELETE requires a WHERE clause".
-- Only change: adds `where true` to the temp-table cleanup DELETEs.
-- Recreates ONLY the two search RPCs using their current/latest implementations.
-- Does NOT touch add_attendance_column, set_member_attendance_from_other_month,
-- member data, attendance data, or month tables.

-- 1. search_workspace_members_across_months
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

  delete from _tmp_cross_month_search_results where true;

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


-- 2. search_workspace_members_across_months_scoped
create or replace function public.search_workspace_members_across_months_scoped(
  p_owner_id uuid,
  p_current_table text,
  p_query text,
  p_limit integer DEFAULT 30,
  p_source_tables text[] DEFAULT NULL,
  p_include_deleted boolean DEFAULT false
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
  is_deleted_in_current_table boolean,
  is_deleted_in_source boolean
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
  v_valid_source_tables text[];
begin
  -- 1. Authorize workspace actor
  perform public.authorize_workspace_actor(p_owner_id);

  if length(v_query) < 2 then
    return;
  end if;

  -- 2. Validate current table if provided
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

  -- 3. Resolve & intersect valid source tables from public.user_month_tables for p_owner_id
  if p_source_tables is not null then
    -- If custom mode provided an empty array, return no results immediately
    if array_length(p_source_tables, 1) is null or array_length(p_source_tables, 1) = 0 then
      return;
    end if;

    select array_agg(distinct umt.table_name)
    into v_valid_source_tables
    from public.user_month_tables umt
    where umt.user_id = p_owner_id
      and umt.table_name = any(p_source_tables)
      and (p_current_table is null or p_current_table = '' or umt.table_name <> p_current_table);

    if v_valid_source_tables is null or array_length(v_valid_source_tables, 1) is null then
      return;
    end if;
  else
    -- If p_source_tables is NULL, use all authorized previous month tables
    select array_agg(distinct umt.table_name)
    into v_valid_source_tables
    from public.user_month_tables umt
    where umt.user_id = p_owner_id
      and (p_current_table is null or p_current_table = '' or umt.table_name <> p_current_table);

    if v_valid_source_tables is null or array_length(v_valid_source_tables, 1) is null then
      return;
    end if;
  end if;

  v_clean_query := lower(regexp_replace(v_query, '[^\w\s]', '', 'g'));
  v_clean_code := upper(regexp_replace(v_query, '[^A-Za-z0-9]', '', 'g'));
  v_clean_phone := regexp_replace(v_query, '\D', '', 'g');

  create temp table if not exists _tmp_scoped_search_results (
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
    m_code text,
    m_updated timestamptz,
    tbl_order integer,
    already_in_cur boolean default false,
    deleted_in_cur boolean default false,
    deleted_in_src boolean default false
  ) on commit drop;

  delete from _tmp_scoped_search_results where true;

  -- 4. Iterate through validated source tables
  for v_rec in (
    select umt.table_name, umt.month_year,
           row_number() over (order by umt.created_at desc, umt.id desc) as ord
    from public.user_month_tables umt
    where umt.user_id = p_owner_id
      and umt.table_name = any(v_valid_source_tables)
    order by umt.created_at desc
  ) loop
    if not exists (
      select 1
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_name = v_rec.table_name
    ) then
      continue;
    end if;

    v_sql := format(
      'insert into _tmp_scoped_search_results (
         member_id, tbl_name, month_lbl, m_name, m_gender, m_phone, m_age,
         m_level, m_pname1, m_pphone1, m_pname2, m_pphone2, m_notes, m_ministry,
         m_visitor, m_dob, m_code, m_updated, tbl_order, deleted_in_src
       )
       select
         m.id,
         %L,
         %L,
         coalesce(m.full_name, m."Full Name", ''Unnamed member''),
         coalesce(m.gender, m."Gender", ''''),
         coalesce(m.phone_number, m."Phone Number", ''''),
         coalesce(m.age, m."Age", ''''),
         coalesce(m.current_level, m."Current Level", ''''),
         coalesce(m.parent_name_1, m."Parent 1 Name", ''''),
         coalesce(m.parent_phone_1, m."Parent 1 Phone", ''''),
         coalesce(m.parent_name_2, m."Parent 2 Name", ''''),
         coalesce(m.parent_phone_2, m."Parent 2 Phone", ''''),
         coalesce(m.notes, m."Notes", ''''),
         coalesce(m.ministry, m."Ministry", ''''),
         coalesce(m.is_visitor, false),
         coalesce(m.date_of_birth, m."Date of Birth", ''''),
         coalesce(m.member_code, ''''),
         coalesce(m.updated_at, m.inserted_at, now()),
         %L,
         case when m.deleted_at is not null then true else false end
       from %I m
       where (%s)
         and (
           lower(coalesce(m.full_name, m."Full Name", '''')) like %L or
           (length(%L) >= 3 and regexp_replace(coalesce(m.phone_number, m."Phone Number", ''''), ''\D'', ''g'') like %L) or
           (length(%L) >= 3 and upper(coalesce(m.member_code, '''')) like %L)
         )',
      v_rec.table_name,
      coalesce(v_rec.month_year, replace(v_rec.table_name, '_', ' ')),
      v_rec.ord,
      v_rec.table_name,
      case when p_include_deleted then 'true' else 'm.deleted_at IS NULL' end,
      '%' || v_clean_query || '%',
      v_clean_phone,
      '%' || v_clean_phone || '%',
      v_clean_code,
      '%' || v_clean_code || '%'
    );

    begin
      execute v_sql;
    exception when others then
      -- Ignore table read errors silently
      null;
    end;
  end loop;

  -- 5. Mark if member is already in current table
  if p_current_table is not null and p_current_table <> '' then
    v_sql := format(
      'update _tmp_scoped_search_results r
       set already_in_cur = (c.deleted_at is null),
           deleted_in_cur = (c.deleted_at is not null)
       from %I c
       where c.id = r.member_id',
      p_current_table
    );
    begin
      execute v_sql;
    exception when others then
      null;
    end;
  end if;

  -- 6. Deduplicate by canonical member_id (newest active profile wins)
  return query
  with ranked as (
    select
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
      r.m_code,
      r.m_updated,
      r.already_in_cur,
      r.deleted_in_cur,
      r.deleted_in_src,
      row_number() over (
        partition by r.member_id
        order by r.deleted_in_src asc, r.tbl_order asc, r.m_updated desc
      ) as rn
    from _tmp_scoped_search_results r
  )
  select
    rk.member_id as canonical_member_id,
    rk.tbl_name as source_table,
    rk.month_lbl as source_month_label,
    rk.m_name as full_name,
    rk.m_gender as gender,
    rk.m_phone as phone_number,
    rk.m_age as age,
    rk.m_level as current_level,
    rk.m_pname1 as parent_name_1,
    rk.m_pphone1 as parent_phone_1,
    rk.m_pname2 as parent_name_2,
    rk.m_pphone2 as parent_phone_2,
    rk.m_notes as notes,
    rk.m_ministry as ministry,
    rk.m_visitor as is_visitor,
    rk.m_dob as date_of_birth,
    rk.m_code as member_code,
    rk.m_updated as source_updated_at,
    rk.already_in_cur as already_in_current_table,
    rk.deleted_in_cur as is_deleted_in_current_table,
    rk.deleted_in_src as is_deleted_in_source
  from ranked rk
  where rk.rn = 1
  order by rk.deleted_in_src asc, rk.m_updated desc
  limit v_limit;
end;
$$;

revoke all on function public.search_workspace_members_across_months_scoped(uuid, text, text, integer, text[], boolean) from public, anon;
grant execute on function public.search_workspace_members_across_months_scoped(uuid, text, text, integer, text[], boolean) to authenticated;
