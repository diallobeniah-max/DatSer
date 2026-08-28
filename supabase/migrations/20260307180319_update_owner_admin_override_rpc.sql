CREATE OR REPLACE FUNCTION update_owner_admin_override(
  p_owner_id UUID,
  p_month_table TEXT,
  p_year INTEGER,
  p_sunday_dates TEXT[],
  p_locked_date TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_requester_id UUID := auth.uid();
BEGIN
  IF v_requester_id = p_owner_id OR EXISTS (
    SELECT 1
    FROM collaborators
    WHERE owner_id = p_owner_id
      AND collaborator_user_id = v_requester_id
      AND status IN ('accepted', 'active')
      AND is_admin = TRUE
  ) THEN
    INSERT INTO user_preferences (
      user_id,
      admin_sticky_month,
      admin_sticky_year,
      admin_sticky_sundays,
      locked_default_date,
      updated_at
    )
    VALUES (
      p_owner_id,
      p_month_table,
      p_year,
      p_sunday_dates,
      p_locked_date,
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
      admin_sticky_month = COALESCE(EXCLUDED.admin_sticky_month, user_preferences.admin_sticky_month),
      admin_sticky_year = COALESCE(EXCLUDED.admin_sticky_year, user_preferences.admin_sticky_year),
      admin_sticky_sundays = COALESCE(EXCLUDED.admin_sticky_sundays, user_preferences.admin_sticky_sundays),
      locked_default_date = EXCLUDED.locked_default_date,
      updated_at = NOW();
    RETURN;
  END IF;

  RAISE EXCEPTION 'Not authorized to update admin override for this workspace';
END;
$$;

GRANT EXECUTE ON FUNCTION update_owner_admin_override(UUID, TEXT, INTEGER, TEXT[], TEXT) TO authenticated;;
