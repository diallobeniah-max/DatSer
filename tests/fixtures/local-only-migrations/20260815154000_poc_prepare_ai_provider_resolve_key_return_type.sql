-- POC bootstrap prerequisite: PostgreSQL cannot change a function return type
-- with CREATE OR REPLACE. The following canonical migration recreates it as jsonb.
drop function if exists public.ai_provider_resolve_key(uuid, text, text);
