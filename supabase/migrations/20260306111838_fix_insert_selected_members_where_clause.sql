CREATE OR REPLACE FUNCTION public.insert_selected_members(source_table text, target_table text, member_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    inserted_count integer := 0;
BEGIN
    IF source_table IS NULL OR source_table = '' OR target_table IS NULL OR target_table = '' OR member_ids IS NULL THEN
        RETURN 0;
    END IF;

    EXECUTE format('DELETE FROM %I WHERE true', target_table);

    EXECUTE format(
        'INSERT INTO %I SELECT * FROM %I WHERE id = ANY($1) ON CONFLICT (id) DO NOTHING',
        target_table,
        source_table
    )
    USING member_ids;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$function$;;
