-- Harden internal member mutation bookkeeping and ensure writes cannot report
-- success when no member row was actually updated.

ALTER TABLE public.member_mutation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_bundle_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.member_mutation_idempotency FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_bundle_audit_log FROM PUBLIC, anon, authenticated;

-- These tables are only accessed by guarded SECURITY DEFINER RPCs. The
-- frontend never needs direct table access to hashes or login attempts.
REVOKE ALL ON TABLE public.admin_login_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_login_code_attempts FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.authorize_workspace_actor(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.month_table_column_exists(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_attendance_column(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_member_bundle(TEXT, UUID, TEXT, JSONB, TEXT[], UUID[], JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_member_bundle(TEXT, UUID, UUID, TEXT, JSONB, TEXT[], UUID[], JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.authorize_workspace_actor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.month_table_column_exists(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_attendance_column(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_member_bundle(TEXT, UUID, TEXT, JSONB, TEXT[], UUID[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_bundle(TEXT, UUID, UUID, TEXT, JSONB, TEXT[], UUID[], JSONB) TO authenticated;

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
  v_affected INTEGER := 0;
BEGIN
  IF p_table_name IS NULL OR p_table_name = '' OR p_member_id IS NULL OR p_updates IS NULL OR p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Invalid parameters';
  END IF;

  PERFORM public.authorize_workspace_actor(p_owner_id);

  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE EXCEPTION 'Month table not found';
  END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_updates)
  LOOP
    IF NOT public.month_table_column_exists(p_table_name, v_key) THEN
      RAISE EXCEPTION 'Column % does not exist in %', v_key, p_table_name;
    END IF;

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
    RAISE EXCEPTION 'No member fields were provided';
  END IF;

  EXECUTE format('UPDATE %I SET %s WHERE id = $1', p_table_name, v_set_clause)
  USING p_member_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'Member update affected % rows', v_affected;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_member_record(TEXT, UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_member_record(TEXT, UUID, JSONB, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
