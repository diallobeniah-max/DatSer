-- Workspace-owned member-code formats. Assignment and conversion stay in a
-- single transaction so collaborators cannot race each other or see a partial
-- format conversion.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS member_code_format TEXT NOT NULL DEFAULT 'alphanumeric';

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_member_code_format_check;
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_member_code_format_check
  CHECK (member_code_format IN ('alphanumeric', 'letters'));

CREATE TABLE IF NOT EXISTS public.workspace_member_codes (
  workspace_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL,
  current_code TEXT NOT NULL,
  alphanumeric_code TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_owner_id, member_id),
  UNIQUE (workspace_owner_id, current_code),
  CHECK (current_code = UPPER(current_code)),
  CHECK (current_code ~ '^[A-Z][A-Z0-9]*$'),
  CHECK (alphanumeric_code IS NULL OR (alphanumeric_code = UPPER(alphanumeric_code) AND alphanumeric_code ~ '^[A-Z][A-Z0-9]*$'))
);

ALTER TABLE public.workspace_member_codes
  ADD COLUMN IF NOT EXISTS alphanumeric_code TEXT;

CREATE INDEX IF NOT EXISTS workspace_member_codes_owner_code_idx
  ON public.workspace_member_codes (workspace_owner_id, current_code);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_member_codes_owner_alphanumeric_code_idx
  ON public.workspace_member_codes (workspace_owner_id, alphanumeric_code)
  WHERE alphanumeric_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS workspace_member_codes_owner_alias_idx
  ON public.workspace_member_codes USING GIN (aliases);

CREATE OR REPLACE FUNCTION public.member_code_letters_only(p_position INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_value INTEGER := p_position;
  v_result TEXT := '';
BEGIN
  IF v_value IS NULL OR v_value < 1 THEN
    RAISE EXCEPTION 'Member code position must be positive';
  END IF;
  WHILE v_value > 0 LOOP
    v_value := v_value - 1;
    v_result := CHR(65 + (v_value % 26)) || v_result;
    v_value := v_value / 26;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_member_code_is_admin(p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = p_owner_id
    OR EXISTS (
      SELECT 1 FROM public.collaborators c
      WHERE c.owner_id = p_owner_id
        AND c.collaborator_user_id = auth.uid()
        AND c.status = 'active'
        AND (c.is_admin = TRUE OR c.role = 'admin')
    );
$$;

ALTER TABLE public.workspace_member_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_member_codes_workspace_read ON public.workspace_member_codes;
CREATE POLICY workspace_member_codes_workspace_read ON public.workspace_member_codes
  FOR SELECT TO authenticated
  USING (public.can_access_workspace(workspace_owner_id));

CREATE OR REPLACE FUNCTION public.ensure_workspace_member_codes(
  p_owner_id UUID,
  p_members JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE(member_id UUID, current_code TEXT, aliases TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_format TEXT;
  v_row JSONB;
  v_member_id UUID;
  v_suggested TEXT;
  v_code TEXT;
  v_position INTEGER;
BEGIN
  PERFORM public.authorize_workspace_actor(p_owner_id);
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::TEXT));

  SELECT COALESCE(member_code_format, 'alphanumeric') INTO v_format
  FROM public.user_preferences WHERE user_id = p_owner_id;
  v_format := COALESCE(v_format, 'alphanumeric');

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_members, '[]'::jsonb)) LOOP
    v_member_id := NULLIF(v_row->>'member_id', '')::UUID;
    IF v_member_id IS NULL THEN CONTINUE; END IF;
    SELECT w.current_code INTO v_code FROM public.workspace_member_codes w
      WHERE w.workspace_owner_id = p_owner_id AND w.member_id = v_member_id;
    IF v_code IS NOT NULL THEN CONTINUE; END IF;

    SELECT COUNT(*) + 1 INTO v_position FROM public.workspace_member_codes
      WHERE workspace_owner_id = p_owner_id;
    v_suggested := UPPER(REGEXP_REPLACE(COALESCE(v_row->>'fallback_code', ''), '[^A-Za-z0-9]', '', 'g'));
    IF v_suggested !~ '^[A-Z][A-Z0-9]*$'
      OR EXISTS (SELECT 1 FROM public.workspace_member_codes WHERE workspace_owner_id = p_owner_id AND alphanumeric_code = v_suggested) THEN
      v_suggested := 'M' || LPAD(v_position::TEXT, 4, '0');
    END IF;
    WHILE EXISTS (
      SELECT 1 FROM public.workspace_member_codes
      WHERE workspace_owner_id = p_owner_id
        AND (alphanumeric_code = v_suggested OR current_code = v_suggested)
    ) LOOP
      v_position := v_position + 1;
      v_suggested := 'M' || LPAD(v_position::TEXT, 4, '0');
    END LOOP;
    v_code := CASE WHEN v_format = 'letters'
      THEN public.member_code_letters_only(v_position)
      ELSE v_suggested END;

    INSERT INTO public.workspace_member_codes(workspace_owner_id, member_id, current_code, alphanumeric_code)
    VALUES (p_owner_id, v_member_id, v_code, v_suggested);
  END LOOP;

  RETURN QUERY
  SELECT w.member_id, w.current_code, w.aliases
  FROM public.workspace_member_codes w
  WHERE w.workspace_owner_id = p_owner_id
    AND w.member_id IN (SELECT NULLIF(value->>'member_id', '')::UUID FROM jsonb_array_elements(COALESCE(p_members, '[]'::jsonb)));
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_workspace_member_code_format(
  p_owner_id UUID,
  p_format TEXT
)
RETURNS TABLE(member_id UUID, current_code TEXT, aliases TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_format TEXT := LOWER(TRIM(COALESCE(p_format, '')));
  v_position INTEGER := 0;
  v_row RECORD;
  v_next_code TEXT;
BEGIN
  IF v_format NOT IN ('alphanumeric', 'letters') THEN
    RAISE EXCEPTION 'Unsupported member code format';
  END IF;
  IF NOT public.workspace_member_code_is_admin(p_owner_id) THEN
    RAISE EXCEPTION 'Only a workspace admin can change the member code format';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::TEXT));

  -- Move every active value to a unique temporary code first. This prevents
  -- transient UNIQUE collisions while A/Z/AA or original alphanumeric values
  -- are being reassigned inside this one transaction.
  UPDATE public.workspace_member_codes w
  SET aliases = ARRAY(SELECT DISTINCT code FROM unnest(w.aliases || ARRAY[w.current_code]) AS code
                      WHERE code IS NOT NULL AND code <> ''),
      current_code = 'TMP' || UPPER(SUBSTRING(REPLACE(w.member_id::TEXT, '-', ''), 1, 24)),
      updated_at = NOW()
  WHERE w.workspace_owner_id = p_owner_id;

  FOR v_row IN
    SELECT * FROM public.workspace_member_codes
    WHERE workspace_owner_id = p_owner_id
    ORDER BY created_at, member_id
  LOOP
    v_position := v_position + 1;
    v_next_code := CASE WHEN v_format = 'letters'
      THEN public.member_code_letters_only(v_position)
      ELSE COALESCE(NULLIF(v_row.alphanumeric_code, ''), 'M' || LPAD(v_position::TEXT, 4, '0')) END;
    UPDATE public.workspace_member_codes
      SET current_code = v_next_code,
          updated_at = NOW()
      WHERE workspace_owner_id = p_owner_id AND member_id = v_row.member_id;
  END LOOP;

  -- Retired aliases remain searchable unless the same value is now somebody
  -- else's current code. Current codes always win exact QR/search resolution.
  UPDATE public.workspace_member_codes w
  SET aliases = ARRAY(
    SELECT DISTINCT alias
    FROM unnest(w.aliases) AS alias
    WHERE alias IS NOT NULL AND alias <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_member_codes active
        WHERE active.workspace_owner_id = p_owner_id
          AND active.member_id <> w.member_id
          AND active.current_code = alias
      )
  )
  WHERE w.workspace_owner_id = p_owner_id;

  INSERT INTO public.user_preferences(user_id, member_code_format, updated_at)
  VALUES (p_owner_id, v_format, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET member_code_format = EXCLUDED.member_code_format,
        updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT w.member_id, w.current_code, w.aliases
    FROM public.workspace_member_codes w WHERE w.workspace_owner_id = p_owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_workspace_member_code(p_owner_id UUID, p_code TEXT)
RETURNS TABLE(member_id UUID, current_code TEXT, matched_alias BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT := UPPER(REGEXP_REPLACE(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  PERFORM public.authorize_workspace_actor(p_owner_id);
  IF v_code = '' THEN RETURN; END IF;
  RETURN QUERY
  SELECT w.member_id, w.current_code, (v_code = ANY(w.aliases))
  FROM public.workspace_member_codes w
  WHERE w.workspace_owner_id = p_owner_id
    AND (w.current_code = v_code OR v_code = ANY(w.aliases))
  ORDER BY (w.current_code = v_code) DESC, w.created_at
  LIMIT 1;
END;
$$;

ALTER TABLE public.workspace_member_codes REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_member_codes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

REVOKE ALL ON FUNCTION public.member_code_letters_only(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_member_code_is_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_workspace_member_codes(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_workspace_member_code_format(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_workspace_member_code(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_code_letters_only(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_member_code_is_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_workspace_member_codes(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_workspace_member_code_format(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_workspace_member_code(UUID, TEXT) TO authenticated;
