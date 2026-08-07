-- Migration: 20260807010000_fix_scoped_search_column_mapping.sql
-- Fixes production bug: search_workspace_members_across_months_scoped returns 200 with []
-- because its dynamic SQL references snake_case columns that do not exist in live
-- month tables (m.full_name, m.gender, m.phone_number, m.age, m.current_level, m.member_code).
-- Live month tables use quoted legacy columns ("Full Name", "Gender", "Phone Number",
-- "Age", "Current Level") plus existing snake_case fields (parent_name_1, parent_phone_1,
-- parent_name_2, parent_phone_2, notes, ministry, is_visitor, date_of_birth, updated_at,
-- deleted_at).
-- This migration recreates ONLY search_workspace_members_across_months_scoped using the
-- same column-safe extraction pattern as search_workspace_members_across_months:
--   - legacy quoted columns for member profile fields
--   - workspace_member_codes join for the member-code search (matching the legacy RPC)
--   - the scoped include_deleted filter is preserved
-- Preserves: signature, return type, authorization, ranking, source-table handling,
-- limits, grants, and the DELETE ... WHERE true fix.
-- Does NOT touch the legacy search RPC, add_attendance_column,
-- set_member_attendance_from_other_month, or any data.

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
         coalesce(wmc.current_code, ''''),
         coalesce(m.updated_at, m.inserted_at, now()),
         %L,
         case when m.deleted_at is not null then true else false end
       from %I m
       left join public.workspace_member_codes wmc
         on wmc.workspace_owner_id = %L and wmc.member_id = m.id
       where (%s)
         and (
           lower(coalesce(m."Full Name", '''')) like %L or
           (length(%L) >= 3 and regexp_replace(coalesce(m."Phone Number", ''''), ''\D'', ''g'') like %L) or
           (length(%L) >= 3 and upper(coalesce(wmc.current_code, '''')) like %L)
         )',
      v_rec.table_name,
      coalesce(v_rec.month_year, replace(v_rec.table_name, '_', ' ')),
      v_rec.ord,
      v_rec.table_name,
      p_owner_id,
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
    coalesce(rk.m_code, '') as member_code,
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
