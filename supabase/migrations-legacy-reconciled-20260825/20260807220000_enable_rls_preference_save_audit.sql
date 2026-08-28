-- Enable RLS on the preference-save audit log.
--
-- Intentionally NO RLS policies, NO FORCE ROW LEVEL SECURITY, NO grant changes:
-- anon/authenticated hold zero direct table grants, and every audit INSERT flows
-- through the postgres-owned SECURITY DEFINER functions (save_personal_preferences
-- / save_workspace_preferences) plus service_role, both of which bypass RLS. This
-- mirrors the existing RLS-enabled audit tables (member_bundle_audit_log,
-- member_mutation_idempotency, admin_login_code_attempts).
ALTER TABLE public.preference_save_audit
ENABLE ROW LEVEL SECURITY;
