-- Fix Admin Code Login hashing when pgcrypto is installed outside public,
-- remove frontend/RLS dependency on protected auth.users for preferences,
-- and publish current data tables for collaborator realtime sync.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.set_admin_login_code(
  p_code TEXT,
  p_label TEXT DEFAULT 'Admin Code Login'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_code TEXT := COALESCE(p_code, '');
  v_label TEXT := COALESCE(NULLIF(TRIM(p_label), ''), 'Admin Code Login');
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF LENGTH(v_code) < 4 THEN
    RAISE EXCEPTION 'Admin code must be at least 4 characters';
  END IF;

  UPDATE public.admin_login_codes
  SET is_active = false,
      updated_at = NOW()
  WHERE owner_id = v_owner
    AND is_active = true;

  INSERT INTO public.admin_login_codes (
    owner_id,
    label,
    code_hash,
    is_active,
    created_by,
    updated_at
  )
  VALUES (
    v_owner,
    v_label,
    extensions.crypt(v_code, extensions.gen_salt('bf')),
    true,
    v_owner,
    NOW()
  );

  RETURN jsonb_build_object('success', true, 'label', v_label);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_admin_code_login(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code TEXT := COALESCE(p_code, '');
  v_code_hash TEXT := encode(extensions.digest(v_code, 'sha256'), 'hex');
  v_owner UUID;
  v_code_id UUID;
  v_user_email TEXT;
  v_workspace_name TEXT;
BEGIN
  IF LENGTH(v_code) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin code must be at least 4 characters');
  END IF;

  SELECT c.id, c.owner_id
  INTO v_code_id, v_owner
  FROM public.admin_login_codes c
  WHERE c.is_active = true
    AND c.code_hash = extensions.crypt(v_code, c.code_hash)
  ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  INSERT INTO public.admin_login_code_attempts (
    owner_id,
    code_hash,
    success
  )
  VALUES (
    v_owner,
    v_code_hash,
    v_code_id IS NOT NULL
  );

  IF v_code_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid admin code');
  END IF;

  UPDATE public.admin_login_codes
  SET last_used_at = NOW()
  WHERE id = v_code_id;

  SELECT u.email
  INTO v_user_email
  FROM auth.users u
  WHERE u.id = v_owner;

  SELECT COALESCE(up.workspace_name, up.church_name, 'DatSer Workspace')
  INTO v_workspace_name
  FROM public.user_preferences up
  WHERE up.user_id = v_owner;

  RETURN jsonb_build_object(
    'success', true,
    'owner_id', v_owner,
    'owner_email', v_user_email,
    'workspace_name', COALESCE(v_workspace_name, 'DatSer Workspace')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_code_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_admin_login_code(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_admin_code_login(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_admin_code_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_login_code(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_code_login(TEXT) TO anon, authenticated;

DROP POLICY IF EXISTS "Users and collaborators can view workspace preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users and collaborators can update workspace preferences" ON public.user_preferences;

CREATE POLICY "Users and collaborators can view workspace preferences"
ON public.user_preferences
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.owner_id = user_preferences.user_id
      AND COALESCE(c.status, '') IN ('accepted', 'active')
      AND (
        c.collaborator_user_id = auth.uid()
        OR LOWER(COALESCE(c.email, '')) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
        OR LOWER(COALESCE(c.collaborator_email, '')) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
      )
  )
);

CREATE POLICY "Users and collaborators can update workspace preferences"
ON public.user_preferences
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.owner_id = user_preferences.user_id
      AND COALESCE(c.status, '') IN ('accepted', 'active')
      AND (
        c.collaborator_user_id = auth.uid()
        OR LOWER(COALESCE(c.email, '')) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
        OR LOWER(COALESCE(c.collaborator_email, '')) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
      )
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.owner_id = user_preferences.user_id
      AND COALESCE(c.status, '') IN ('accepted', 'active')
      AND (
        c.collaborator_user_id = auth.uid()
        OR LOWER(COALESCE(c.email, '')) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
        OR LOWER(COALESCE(c.collaborator_email, '')) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
      )
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborators TO authenticated;
GRANT SELECT ON public.user_month_tables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_login_codes TO authenticated;
GRANT INSERT ON public.admin_login_code_attempts TO anon, authenticated;

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'attendance_records',
    'attendance_sessions',
    'user_preferences',
    'collaborators',
    'user_month_tables',
    'January_2026',
    'February_2026',
    'March_2026',
    'April_2026',
    'May_2026',
    'June_2026',
    'July_2026'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';;
