CREATE OR REPLACE FUNCTION set_month_owner_user(
    target_table TEXT,
    owner_user_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    updated_count INTEGER := 0;
BEGIN
    IF target_table IS NULL OR target_table = '' OR owner_user_id IS NULL THEN
        RETURN 0;
    END IF;

    EXECUTE format(
        'UPDATE %I SET user_id = $1 WHERE user_id IS DISTINCT FROM $1',
        target_table
    )
    USING owner_user_id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION set_month_owner_user(TEXT, UUID) TO authenticated;
