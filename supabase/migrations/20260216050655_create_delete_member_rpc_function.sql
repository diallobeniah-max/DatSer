CREATE OR REPLACE FUNCTION delete_member_by_id(target_table TEXT, member_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE format('DELETE FROM %I WHERE id = $1', target_table) USING member_id;
  RETURN FOUND;
END;
$$;;
