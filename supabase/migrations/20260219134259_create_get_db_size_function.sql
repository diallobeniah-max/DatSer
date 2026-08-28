
CREATE OR REPLACE FUNCTION get_database_usage()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'db_size_bytes', pg_database_size(current_database()),
    'db_size_mb', round(pg_database_size(current_database()) / 1048576.0, 2),
    'db_limit_mb', 500,
    'tables', (
      SELECT json_agg(t ORDER BY t.total_bytes DESC)
      FROM (
        SELECT 
          c.relname as table_name,
          pg_total_relation_size(c.oid) as total_bytes,
          round(pg_total_relation_size(c.oid) / 1048576.0, 2) as size_mb
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY total_bytes DESC
      ) t
    )
  ) INTO result;
  
  RETURN result;
END;
$$;
;
