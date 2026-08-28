CREATE OR REPLACE FUNCTION reset_month_members(
    target_table TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INTEGER := 0;
BEGIN
    IF target_table IS NULL OR target_table = '' THEN
        RETURN 0;
    END IF;

    EXECUTE format('DELETE FROM %I', target_table);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_month_members(TEXT) TO authenticated;

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
    IF source_table IS NULL OR source_table = '' OR target_table IS NULL OR target_table = '' OR member_ids IS NULL THEN
        RETURN 0;
    END IF;

    EXECUTE format('DELETE FROM %I', target_table);

    EXECUTE format(
        'INSERT INTO %I SELECT * FROM %I WHERE id = ANY($1) ON CONFLICT (id) DO NOTHING',
        target_table,
        source_table
    )
    USING member_ids;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_selected_members(TEXT, TEXT, UUID[]) TO authenticated;
