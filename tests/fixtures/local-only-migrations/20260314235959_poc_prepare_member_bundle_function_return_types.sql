-- POC-only bootstrap reconciliation.
-- The canonical member bundle migration immediately recreates this function
-- with a BOOLEAN return type and restores its authenticated grant.
drop function public.add_attendance_column(text, text);
