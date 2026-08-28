-- Migration: Insert selected members into a new month table (bypass RLS)

CREATE OR REPLACE FUNCTION insert_selected_members(
    source_table TEXT,
    target_table TEXT,
    member_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    inserted_count INTEGER := 0;
BEGIN
    IF source_table IS NULL OR target_table IS NULL OR member_ids IS NULL THEN
        RETURN 0;
    END IF;

    EXECUTE format(
        'INSERT INTO %I SELECT * FROM %I WHERE id = ANY($1)',
        target_table,
        source_table
    )
    USING member_ids;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_selected_members(TEXT, TEXT, UUID[]) TO authenticated;
