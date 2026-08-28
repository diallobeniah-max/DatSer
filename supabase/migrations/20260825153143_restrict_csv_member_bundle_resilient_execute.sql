-- CSV Import uses the trusted wrapper from authenticated browser sessions.
-- The wrapper is SECURITY DEFINER, so it must never inherit PUBLIC/anon EXECUTE.
revoke all on function public.save_member_bundle_resilient(text, uuid, text, jsonb, text[], uuid[], jsonb) from public, anon;
grant execute on function public.save_member_bundle_resilient(text, uuid, text, jsonb, text[], uuid[], jsonb) to authenticated;

notify pgrst, 'reload schema';
