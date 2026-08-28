CREATE OR REPLACE FUNCTION public.update_member_record(
  p_table_name TEXT,
  p_member_id UUID,
  p_updates JSONB,
  p_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_id UUID := auth.uid();
  v_set_clause TEXT := '';
  v_part TEXT;
  v_key TEXT;
  v_val JSONB;
BEGIN
  IF p_table_name IS NULL OR p_table_name = '' OR p_member_id IS NULL OR p_updates IS NULL OR p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Invalid parameters';
  END IF;

  IF NOT (
    v_requester_id = p_owner_id OR EXISTS (
      SELECT 1
      FROM public.collaborators c
      WHERE c.owner_id = p_owner_id
        AND c.status IN ('accepted', 'active')
        AND (
          c.collaborator_user_id = v_requester_id
          OR EXISTS (
            SELECT 1
            FROM auth.users au
            WHERE au.id = v_requester_id
              AND (c.email = au.email OR c.email ILIKE au.email)
          )
        )
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to update this member';
  END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_updates)
  LOOP
    IF v_set_clause <> '' THEN
      v_set_clause := v_set_clause || ', ';
    END IF;

    IF v_val IS NULL OR v_val = 'null'::jsonb THEN
      v_part := format('%I = NULL', v_key);
    ELSE
      v_part := format('%I = %L', v_key, v_val #>> '{}');
    END IF;

    v_set_clause := v_set_clause || v_part;
  END LOOP;

  IF v_set_clause = '' THEN
    RETURN;
  END IF;

  EXECUTE format('UPDATE %I SET %s WHERE id = $1', p_table_name, v_set_clause)
  USING p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_member_record(TEXT, UUID, JSONB, UUID) TO authenticated;
