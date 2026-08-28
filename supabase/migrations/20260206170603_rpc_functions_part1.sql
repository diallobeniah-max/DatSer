
-- ============================================
-- Migration 3a: RPC Functions (Part 1 - Utility)
-- ============================================

-- 1. get_owner_workspace_name
CREATE OR REPLACE FUNCTION public.get_owner_workspace_name(owner_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ws_name TEXT;
BEGIN
  SELECT workspace_name INTO ws_name
  FROM public.user_preferences
  WHERE user_id = owner_uuid;
  RETURN ws_name;
END;
$$;

-- 2. get_table_columns
CREATE OR REPLACE FUNCTION public.get_table_columns(table_name TEXT)
RETURNS TABLE(column_name TEXT, data_type TEXT, is_nullable TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT c.column_name::TEXT, c.data_type::TEXT, c.is_nullable::TEXT
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = get_table_columns.table_name
  ORDER BY c.ordinal_position;
END;
$$;

-- 3. add_attendance_column
CREATE OR REPLACE FUNCTION public.add_attendance_column(table_name TEXT, column_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE format(
    'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I TEXT',
    table_name, column_name
  );
END;
$$;

-- 4. delete_user
CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- 5. update_user_workspace_name
CREATE OR REPLACE FUNCTION public.update_user_workspace_name(new_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  tbl RECORD;
BEGIN
  -- Update user_preferences
  UPDATE public.user_preferences
  SET workspace_name = new_name, updated_at = NOW()
  WHERE user_id = auth.uid();

  -- Update workspace column in all user's month tables
  FOR tbl IN
    SELECT umt.table_name
    FROM public.user_month_tables umt
    WHERE umt.user_id = auth.uid()
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE public.%I SET workspace = $1 WHERE user_id = $2',
        tbl.table_name
      ) USING new_name, auth.uid();
    EXCEPTION WHEN undefined_column THEN
      -- Table doesn't have workspace column, skip
      NULL;
    WHEN undefined_table THEN
      -- Table doesn't exist, skip
      NULL;
    END;
  END LOOP;
END;
$$;
;
