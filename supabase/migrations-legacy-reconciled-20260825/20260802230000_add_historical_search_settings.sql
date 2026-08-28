-- Migration: 20260802230000_add_historical_search_settings.sql
-- Description: Add historical_search_settings JSONB column to user_preferences, update settings RPC, and create scoped search RPC

-- 1. Add historical_search_settings column to public.user_preferences if it does not exist
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS historical_search_settings jsonb DEFAULT '{
  "mode": "all_previous",
  "recent_months": 6,
  "selected_tables": [],
  "include_deleted": false
}'::jsonb;

-- 2. RPC to update historical_search_settings safely
CREATE OR REPLACE FUNCTION public.update_historical_search_settings(
  p_owner_id uuid,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_mode text;
  v_recent integer;
  v_include_deleted boolean;
  v_clean_settings jsonb;
  v_selected_tables jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Authorize workspace actor (raises when unauthorized)
  PERFORM public.authorize_workspace_actor(p_owner_id);

  -- Validate mode
  v_mode := COALESCE(p_settings->>'mode', 'all_previous');
  IF v_mode NOT IN ('all_previous', 'recent', 'custom') THEN
    v_mode := 'all_previous';
  END IF;

  -- Validate recent_months
  v_recent := COALESCE((p_settings->>'recent_months')::integer, 6);
  IF v_recent NOT IN (3, 6, 12) THEN
    v_recent := 6;
  END IF;

  -- Validate include_deleted
  v_include_deleted := COALESCE((p_settings->>'include_deleted')::boolean, false);

  -- Validate selected_tables array if custom mode
  IF jsonb_typeof(p_settings->'selected_tables') = 'array' THEN
    v_selected_tables := p_settings->'selected_tables';
  ELSE
    v_selected_tables := '[]'::jsonb;
  END IF;

  v_clean_settings := jsonb_build_object(
    'mode', v_mode,
    'recent_months', v_recent,
    'selected_tables', v_selected_tables,
    'include_deleted', v_include_deleted
  );

  UPDATE public.user_preferences
  SET historical_search_settings = v_clean_settings,
      updated_at = NOW()
  WHERE user_id = p_owner_id;

  RETURN v_clean_settings;
END;
$$;

REVOKE ALL ON FUNCTION public.update_historical_search_settings(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_historical_search_settings(uuid, jsonb) TO authenticated;

-- 3. Scoped Search RPC: public.search_workspace_members_across_months_scoped
CREATE OR REPLACE FUNCTION public.search_workspace_members_across_months_scoped(
  p_owner_id uuid,
  p_current_table text,
  p_query text,
  p_limit integer DEFAULT 30,
  p_source_tables text[] DEFAULT NULL,
  p_include_deleted boolean DEFAULT false
)
RETURNS TABLE (
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := trim(coalesce(p_query, ''));
  v_clean_query text;
  v_clean_code text;
  v_clean_phone text;
  v_rec record;
  v_sql text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_current_valid boolean := false;
  v_valid_source_tables text[];
BEGIN
  -- 1. Authorize workspace actor
  PERFORM public.authorize_workspace_actor(p_owner_id);

  IF length(v_query) < 2 THEN
    RETURN;
  END IF;

  -- 2. Validate current table if provided
  IF p_current_table IS NOT NULL AND p_current_table <> '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_month_tables umt
      WHERE umt.user_id = p_owner_id AND umt.table_name = p_current_table
    ) INTO v_current_valid;

    IF NOT v_current_valid THEN
      RAISE EXCEPTION 'Current table % is not authorized for workspace owner %', p_current_table, p_owner_id;
    END IF;
  END IF;

  -- 3. Resolve & intersect valid source tables from public.user_month_tables for p_owner_id
  IF p_source_tables IS NOT NULL THEN
    -- If custom mode provided an empty array, return no results immediately
    IF array_length(p_source_tables, 1) IS NULL OR array_length(p_source_tables, 1) = 0 THEN
      RETURN;
    END IF;

    SELECT array_agg(DISTINCT umt.table_name)
    INTO v_valid_source_tables
    FROM public.user_month_tables umt
    WHERE umt.user_id = p_owner_id
      AND umt.table_name = ANY(p_source_tables)
      AND (p_current_table IS NULL OR p_current_table = '' OR umt.table_name <> p_current_table);

    IF v_valid_source_tables IS NULL OR array_length(v_valid_source_tables, 1) IS NULL THEN
      RETURN;
    END IF;
  ELSE
    -- If p_source_tables is NULL, use all authorized previous month tables
    SELECT array_agg(DISTINCT umt.table_name)
    INTO v_valid_source_tables
    FROM public.user_month_tables umt
    WHERE umt.user_id = p_owner_id
      AND (p_current_table IS NULL OR p_current_table = '' OR umt.table_name <> p_current_table);

    IF v_valid_source_tables IS NULL OR array_length(v_valid_source_tables, 1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  v_clean_query := lower(regexp_replace(v_query, '[^\w\s]', '', 'g'));
  v_clean_code := upper(regexp_replace(v_query, '[^A-Za-z0-9]', '', 'g'));
  v_clean_phone := regexp_replace(v_query, '\D', '', 'g');

  CREATE TEMP TABLE IF NOT EXISTS _tmp_scoped_search_results (
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
    already_in_cur boolean DEFAULT false,
    deleted_in_cur boolean DEFAULT false,
    deleted_in_src boolean DEFAULT false
  ) ON COMMIT DROP;

  DELETE FROM _tmp_scoped_search_results;

  -- 4. Iterate through validated source tables
  FOR v_rec IN (
    SELECT umt.table_name, umt.month_year,
           row_number() OVER (ORDER BY umt.created_at DESC, umt.id DESC) AS ord
    FROM public.user_month_tables umt
    WHERE umt.user_id = p_owner_id
      AND umt.table_name = ANY(v_valid_source_tables)
    ORDER BY umt.created_at DESC
  ) LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = v_rec.table_name
    ) THEN
      CONTINUE;
    END IF;

    v_sql := format(
      'INSERT INTO _tmp_scoped_search_results (
         member_id, tbl_name, month_lbl, m_name, m_gender, m_phone, m_age,
         m_level, m_pname1, m_pphone1, m_pname2, m_pphone2, m_notes, m_ministry,
         m_visitor, m_dob, m_code, m_updated, tbl_order, deleted_in_src
       )
       SELECT
         m.id,
         %L,
         %L,
         COALESCE(m.full_name, m."Full Name", ''Unnamed member''),
         COALESCE(m.gender, m."Gender", ''''),
         COALESCE(m.phone_number, m."Phone Number", ''''),
         COALESCE(m.age, m."Age", ''''),
         COALESCE(m.current_level, m."Current Level", ''''),
         COALESCE(m.parent_name_1, m."Parent 1 Name", ''''),
         COALESCE(m.parent_phone_1, m."Parent 1 Phone", ''''),
         COALESCE(m.parent_name_2, m."Parent 2 Name", ''''),
         COALESCE(m.parent_phone_2, m."Parent 2 Phone", ''''),
         COALESCE(m.notes, m."Notes", ''''),
         COALESCE(m.ministry, m."Ministry", ''''),
         COALESCE(m.is_visitor, false),
         COALESCE(m.date_of_birth, m."Date of Birth", ''''),
         COALESCE(m.member_code, ''''),
         COALESCE(m.updated_at, m.inserted_at, NOW()),
         %L,
         CASE WHEN m.deleted_at IS NOT NULL THEN true ELSE false END
       FROM %I m
       WHERE (%s)
         AND (
           lower(COALESCE(m.full_name, m."Full Name", '''')) LIKE %L OR
           (length(%L) >= 3 AND regexp_replace(COALESCE(m.phone_number, m."Phone Number", ''''), ''\D'', ''g'') LIKE %L) OR
           (length(%L) >= 3 AND upper(COALESCE(m.member_code, '''')) LIKE %L)
         )',
      v_rec.table_name,
      COALESCE(v_rec.month_year, replace(v_rec.table_name, '_', ' ')),
      v_rec.ord,
      v_rec.table_name,
      CASE WHEN p_include_deleted THEN 'true' ELSE 'm.deleted_at IS NULL' END,
      '%' || v_clean_query || '%',
      v_clean_phone,
      '%' || v_clean_phone || '%',
      v_clean_code,
      '%' || v_clean_code || '%'
    );

    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      -- Ignore table read errors silently
      NULL;
    END;
  END LOOP;

  -- 5. Mark if member is already in current table
  IF p_current_table IS NOT NULL AND p_current_table <> '' THEN
    v_sql := format(
      'UPDATE _tmp_scoped_search_results r
       SET already_in_cur = (c.deleted_at IS NULL),
           deleted_in_cur = (c.deleted_at IS NOT NULL)
       FROM %I c
       WHERE c.id = r.member_id',
      p_current_table
    );
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- 6. Deduplicate by canonical member_id (newest active profile wins)
  RETURN QUERY
  WITH ranked AS (
    SELECT
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
      row_number() OVER (
        PARTITION BY r.member_id
        ORDER BY r.deleted_in_src ASC, r.tbl_order ASC, r.m_updated DESC
      ) AS rn
    FROM _tmp_scoped_search_results r
  )
  SELECT
    rk.member_id AS canonical_member_id,
    rk.tbl_name AS source_table,
    rk.month_lbl AS source_month_label,
    rk.m_name AS full_name,
    rk.m_gender AS gender,
    rk.m_phone AS phone_number,
    rk.m_age AS age,
    rk.m_level AS current_level,
    rk.m_pname1 AS parent_name_1,
    rk.m_pphone1 AS parent_phone_1,
    rk.m_pname2 AS parent_name_2,
    rk.m_pphone2 AS parent_phone_2,
    rk.m_notes AS notes,
    rk.m_ministry AS ministry,
    rk.m_visitor AS is_visitor,
    rk.m_dob AS date_of_birth,
    rk.m_code AS member_code,
    rk.m_updated AS source_updated_at,
    rk.already_in_cur AS already_in_current_table,
    rk.deleted_in_cur AS is_deleted_in_current_table,
    rk.deleted_in_src AS is_deleted_in_source
  FROM ranked rk
  WHERE rk.rn = 1
  ORDER BY rk.deleted_in_src ASC, rk.m_updated DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_workspace_members_across_months_scoped(uuid, text, text, integer, text[], boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.search_workspace_members_across_months_scoped(uuid, text, text, integer, text[], boolean) TO authenticated;
