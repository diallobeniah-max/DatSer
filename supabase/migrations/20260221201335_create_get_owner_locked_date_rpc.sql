CREATE OR REPLACE FUNCTION get_owner_locked_date(owner_uuid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result text;
BEGIN
  -- Verify the caller is either the owner or an active collaborator
  IF auth.uid() != owner_uuid THEN
    IF NOT EXISTS (
      SELECT 1 FROM collaborators
      WHERE owner_id = owner_uuid
        AND collaborator_user_id = auth.uid()
        AND status IN ('accepted', 'active')
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  SELECT locked_default_date INTO result
  FROM user_preferences
  WHERE user_id = owner_uuid;

  RETURN result;
END;
$$;;
