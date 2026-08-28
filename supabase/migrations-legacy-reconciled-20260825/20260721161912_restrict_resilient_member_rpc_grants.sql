-- The project default privileges grant new public functions directly to anon.
-- These owner-scoped recovery RPCs are authenticated application endpoints only.
revoke all on function public.resolve_member_update_target(text, uuid, uuid, jsonb) from public, anon;
revoke all on function public.update_member_record_resilient(text, uuid, jsonb, uuid, jsonb) from public, anon;
revoke all on function public.update_member_bundle_resilient(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb, jsonb) from public, anon;

grant execute on function public.resolve_member_update_target(text, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_member_record_resilient(text, uuid, jsonb, uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_member_bundle_resilient(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
