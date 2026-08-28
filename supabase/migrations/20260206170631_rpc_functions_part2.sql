
-- ============================================
-- Migration 3b: RPC Functions (Part 2 - Month Tables)
-- ============================================

-- 6. get_available_month_tables
CREATE OR REPLACE FUNCTION public.get_available_month_tables(target_user_id UUID)
RETURNS TABLE(table_name TEXT, month_year TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT umt.table_name, umt.month_year
  FROM public.user_month_tables umt
  WHERE umt.user_id = target_user_id
  ORDER BY umt.created_at;
END;
$$;

-- 7. drop_month_table
CREATE OR REPLACE FUNCTION public.drop_month_table(table_to_drop TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Drop the actual table
  EXECUTE format('DROP TABLE IF EXISTS public.%I', table_to_drop);
  
  -- Clean up registry entries for all users
  DELETE FROM public.user_month_tables
  WHERE user_month_tables.table_name = table_to_drop;
END;
$$;

-- 8. register_collaborators_for_month
CREATE OR REPLACE FUNCTION public.register_collaborators_for_month(
  p_owner_id UUID,
  p_table_name TEXT,
  p_month_year TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER := 0;
  v_collab RECORD;
  v_collab_user_id UUID;
BEGIN
  FOR v_collab IN
    SELECT email FROM public.collaborators
    WHERE owner_id = p_owner_id
    AND status IN ('pending', 'accepted', 'active')
  LOOP
    -- Find the auth user id for this collaborator email
    SELECT id INTO v_collab_user_id
    FROM auth.users
    WHERE lower(email) = lower(v_collab.email)
    LIMIT 1;

    IF v_collab_user_id IS NOT NULL THEN
      -- Insert into user_month_tables if not already there
      INSERT INTO public.user_month_tables (user_id, table_name, month_year)
      VALUES (v_collab_user_id, p_table_name, p_month_year)
      ON CONFLICT (user_id, table_name) DO NOTHING;

      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 9. create_month_from_current
CREATE OR REPLACE FUNCTION public.create_month_from_current(
  source_table TEXT,
  new_table_name TEXT,
  sunday_dates TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_members_copied INTEGER := 0;
  v_sunday TEXT;
  v_col_name TEXT;
BEGIN
  -- Create new table by copying structure and data from source
  IF source_table IS NOT NULL AND source_table != '' THEN
    -- Check if source table exists
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND information_schema.tables.table_name = source_table
    ) THEN
      EXECUTE format('CREATE TABLE public.%I (LIKE public.%I INCLUDING ALL)', new_table_name, source_table);
      EXECUTE format('INSERT INTO public.%I SELECT * FROM public.%I', new_table_name, source_table);
      EXECUTE format('SELECT count(*) FROM public.%I', new_table_name) INTO v_members_copied;
    ELSE
      -- Source doesn't exist, create empty table with standard structure
      EXECUTE format(
        'CREATE TABLE public.%I (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          "Full Name" TEXT,
          "Gender" TEXT,
          "Phone Number" BIGINT,
          "Age" INTEGER,
          "Current Level" TEXT,
          workspace TEXT,
          user_id UUID,
          parent_name_1 TEXT,
          parent_phone_1 BIGINT,
          parent_name_2 TEXT,
          parent_phone_2 BIGINT,
          notes TEXT,
          ministry TEXT,
          is_visitor BOOLEAN DEFAULT false,
          inserted_at TIMESTAMPTZ DEFAULT NOW(),
          "Member" TEXT,
          "Regular" TEXT,
          "Newcomer" TEXT,
          "Manual Badge" TEXT,
          "Badge Type" TEXT,
          "Join Date" TEXT,
          "Member Status" TEXT,
          "Manual Badges" JSONB
        )', new_table_name
      );
    END IF;
  ELSE
    -- No source table, create empty
    EXECUTE format(
      'CREATE TABLE public.%I (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "Full Name" TEXT,
        "Gender" TEXT,
        "Phone Number" BIGINT,
        "Age" INTEGER,
        "Current Level" TEXT,
        workspace TEXT,
        user_id UUID,
        parent_name_1 TEXT,
        parent_phone_1 BIGINT,
        parent_name_2 TEXT,
        parent_phone_2 BIGINT,
        notes TEXT,
        ministry TEXT,
        is_visitor BOOLEAN DEFAULT false,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        "Member" TEXT,
        "Regular" TEXT,
        "Newcomer" TEXT,
        "Manual Badge" TEXT,
        "Badge Type" TEXT,
        "Join Date" TEXT,
        "Member Status" TEXT,
        "Manual Badges" JSONB
      )', new_table_name
    );
  END IF;

  -- Add attendance columns for each Sunday date
  FOREACH v_sunday IN ARRAY sunday_dates
  LOOP
    v_col_name := 'attendance_' || replace(v_sunday, '-', '_');
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I TEXT',
      new_table_name, v_col_name
    );
  END LOOP;

  -- Enable RLS on the new table
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', new_table_name);

  -- Create RLS policies for the new month table
  EXECUTE format(
    'CREATE POLICY "Users can view own rows" ON public.%I FOR SELECT USING (user_id = auth.uid() OR user_id IN (SELECT owner_id FROM public.collaborators WHERE lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())) AND status IN (''pending'', ''accepted'', ''active'')))',
    new_table_name
  );

  EXECUTE format(
    'CREATE POLICY "Users can insert own rows" ON public.%I FOR INSERT WITH CHECK (user_id = auth.uid())',
    new_table_name
  );

  EXECUTE format(
    'CREATE POLICY "Users can update own rows" ON public.%I FOR UPDATE USING (user_id = auth.uid() OR user_id IN (SELECT owner_id FROM public.collaborators WHERE lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())) AND status IN (''pending'', ''accepted'', ''active'')))',
    new_table_name
  );

  EXECUTE format(
    'CREATE POLICY "Users can delete own rows" ON public.%I FOR DELETE USING (user_id = auth.uid())',
    new_table_name
  );

  RETURN jsonb_build_object(
    'success', true,
    'table_name', new_table_name,
    'members_copied', v_members_copied
  );
END;
$$;
;
