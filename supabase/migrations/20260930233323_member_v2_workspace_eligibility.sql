-- Read-only routing hint for one authorized workspace. The rollout table
-- remains private and every trusted mutation still enforces the server gate.
create or replace function public.member_v2_workspace_eligible(p_owner_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  return exists (
    select 1 from public.member_v2_rollout_workspaces
    where owner_id = p_owner_id and enabled
  );
end;
$$;

revoke all on function public.member_v2_workspace_eligible(uuid) from public, anon;
grant execute on function public.member_v2_workspace_eligible(uuid) to authenticated;

notify pgrst, 'reload schema';
