-- POC-only bootstrap reconciliation.
-- The next historical migration recreates this exact signature with a JSONB
-- return type. PostgreSQL requires dropping the BOOLEAN version first.
drop function public.add_attendance_column(text, text);
