-- POC-only bootstrap reconciliation.
-- PostgreSQL cannot change a function return type with CREATE OR REPLACE.
-- The next historical migration recreates this exact signature as JSONB and
-- restores its authenticated grant, so remove the earlier VOID definition.
drop function public.update_owner_admin_override(uuid, text, integer, text[], text);
