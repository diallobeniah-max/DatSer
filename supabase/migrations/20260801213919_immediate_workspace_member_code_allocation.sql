-- Return one confirmed assignment for the Add Member completion path.
-- The underlying allocator owns authorization, locking, format/length rules,
-- capacity checks, and idempotent uniqueness. This wrapper avoids returning
-- an entire workspace assignment set after every individual member create.
create or replace function public.ensure_workspace_member_code(
  p_owner_id uuid,
  p_member jsonb
)
returns public.workspace_member_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid := nullif(p_member ->> 'id', '')::uuid;
  v_assignment public.workspace_member_codes%rowtype;
begin
  if v_member_id is null then
    raise exception 'A canonical member id is required for member-code allocation';
  end if;

  select *
  into v_assignment
  from public.ensure_workspace_member_codes(
    p_owner_id,
    jsonb_build_array(p_member)
  ) assignment
  where assignment.member_id = v_member_id
  limit 1;

  if not found then
    raise exception 'Member-code allocation completed without an assignment';
  end if;

  return v_assignment;
end;
$$;

revoke all on function public.ensure_workspace_member_code(uuid, jsonb) from public, anon;
grant execute on function public.ensure_workspace_member_code(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';;
