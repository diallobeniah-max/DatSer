
-- ============================================
-- Migration 3c: RPC Functions (Part 3 - Collaborator Defaults + Exec)
-- ============================================

-- 10. set_collaborators_default_month
CREATE OR REPLACE FUNCTION public.set_collaborators_default_month(
    p_owner_id UUID,
    p_month_table TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    UPDATE public.user_preferences
    SET
        current_month_table = p_month_table,
        updated_at = NOW()
    WHERE user_id IN (
        SELECT DISTINCT
            CASE
                WHEN email ~ '^[a-f0-9-]{36}$' THEN email::uuid
                ELSE (SELECT id FROM auth.users WHERE lower(auth.users.email) = lower(collaborators.email) LIMIT 1)
            END
        FROM public.collaborators
        WHERE owner_id = p_owner_id
        AND status IN ('pending', 'accepted', 'active')
    )
    AND user_id IS NOT NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 11. set_collaborators_default_sundays
CREATE OR REPLACE FUNCTION public.set_collaborators_default_sundays(
    p_owner_id UUID,
    p_sunday_dates TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    UPDATE public.user_preferences
    SET
        admin_sticky_sundays = p_sunday_dates,
        updated_at = NOW()
    WHERE user_id IN (
        SELECT DISTINCT
            CASE
                WHEN email ~ '^[a-f0-9-]{36}$' THEN email::uuid
                ELSE (SELECT id FROM auth.users WHERE lower(auth.users.email) = lower(collaborators.email) LIMIT 1)
            END
        FROM public.collaborators
        WHERE owner_id = p_owner_id
        AND status IN ('pending', 'accepted', 'active')
    )
    AND user_id IS NOT NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 12. get_exec_attendance
CREATE OR REPLACE FUNCTION public.get_exec_attendance(month TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB := '[]'::JSONB;
  v_row RECORD;
  v_attendance_cols TEXT[];
  v_col TEXT;
  v_total_dates INTEGER;
  v_present_count INTEGER;
  v_query TEXT;
BEGIN
  -- Check if the table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = month
  ) THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Get attendance columns
  SELECT array_agg(column_name::TEXT ORDER BY column_name)
  INTO v_attendance_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = month
    AND (column_name LIKE 'attendance_%' OR column_name LIKE 'Attendance %');

  IF v_attendance_cols IS NULL OR array_length(v_attendance_cols, 1) IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  v_total_dates := array_length(v_attendance_cols, 1);

  -- Build dynamic query to count present for each member
  v_query := format('SELECT id, "Full Name", ');
  
  -- Build CASE expressions for each attendance column
  v_query := v_query || '(';
  FOR i IN 1..v_total_dates LOOP
    IF i > 1 THEN v_query := v_query || ' + '; END IF;
    v_query := v_query || format('CASE WHEN %I = ''Present'' THEN 1 ELSE 0 END', v_attendance_cols[i]);
  END LOOP;
  v_query := v_query || format(') as present_count, %s as total_dates FROM public.%I', v_total_dates, month);

  v_result := '[]'::JSONB;
  FOR v_row IN EXECUTE v_query
  LOOP
    v_result := v_result || jsonb_build_object(
      'id', v_row.id,
      'name', v_row."Full Name",
      'present', v_row.present_count,
      'total', v_row.total_dates
    );
  END LOOP;

  RETURN v_result;
END;
$$;
;
