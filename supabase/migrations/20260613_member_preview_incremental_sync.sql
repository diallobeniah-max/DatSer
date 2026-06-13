-- Keep member preview sync lightweight and deletion-aware.
-- This migration adds a small helper that ensures the month table has the sync columns
-- the app relies on, plus a soft-delete RPC so deleted members can still be detected
-- by background incremental sync without re-downloading whole tables.

CREATE OR REPLACE FUNCTION public.ensure_month_member_sync_columns(target_table TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF target_table IS NULL OR target_table = '' THEN
        RETURN FALSE;
    END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ', target_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', target_table);

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_month_member_sync_columns(TEXT) TO authenticated;

COMMENT ON FUNCTION public.ensure_month_member_sync_columns(TEXT) IS
  'Ensures a month table exposes updated_at and deleted_at so the app can perform incremental member syncs.';


CREATE OR REPLACE FUNCTION public.soft_delete_member(target_table TEXT, member_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    affected_rows INTEGER := 0;
BEGIN
    IF target_table IS NULL OR target_table = '' OR member_id IS NULL THEN
        RETURN FALSE;
    END IF;

    PERFORM public.ensure_month_member_sync_columns(target_table);

    EXECUTE format(
        'UPDATE %I SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
        target_table
    )
    USING member_id;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_member(TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.soft_delete_member(TEXT, UUID) IS
  'Soft deletes a member row so background preview sync can detect removals incrementally.';
