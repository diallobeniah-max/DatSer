CREATE OR REPLACE FUNCTION public.reset_month_members(target_table text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    deleted_count integer := 0;
BEGIN
    IF target_table IS NULL OR target_table = '' THEN
        RETURN 0;
    END IF;

    EXECUTE format('DELETE FROM %I WHERE true', target_table);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$function$;;
