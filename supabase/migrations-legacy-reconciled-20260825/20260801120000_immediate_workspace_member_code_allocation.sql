-- Authorize active workspace collaborators to ensure member codes during member creation.
-- Format and length changes remain restricted to workspace owners/admins, but member
-- code allocation is part of member creation and must succeed for any authorized collaborator.
create or replace function public.ensure_workspace_member_codes(
  p_owner_id uuid,
  p_members jsonb
)
returns setof public.workspace_member_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_format text;
  v_length smallint;
  v_next bigint;
  v_inserted bigint;
begin
  perform public.authorize_workspace_actor(p_owner_id);
  perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));
  select coalesce(member_code_format, 'alphanumeric'), coalesce(member_code_length, 3)::smallint
    into v_format, v_length from public.user_preferences where user_id = p_owner_id;
  select coalesce(max(ordinal), 0) into v_next from public.workspace_member_codes where workspace_owner_id = p_owner_id;

  with incoming as (
    select nullif(value ->> 'id', '')::uuid as member_id,
      upper(regexp_replace(coalesce(value ->> 'legacy_code', ''), '[^A-Za-z0-9]', '', 'g')) as legacy_code
    from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
  ), missing as (
    select incoming.member_id, incoming.legacy_code,
      row_number() over (order by incoming.legacy_code, incoming.member_id)::bigint as row_number
    from incoming
    where incoming.member_id is not null
      and not exists (
        select 1 from public.workspace_member_codes existing
        where existing.workspace_owner_id = p_owner_id and existing.member_id = incoming.member_id
      )
  ), inserted as (
    insert into public.workspace_member_codes (workspace_owner_id, member_id, ordinal, legacy_code, current_code)
    select p_owner_id, member_id, v_next + row_number, legacy_code,
      '__PENDING__' || txid_current()::text || '_' || (v_next + row_number)::text
    from missing
    on conflict do nothing
    returning member_id
  )
  select count(*) into v_inserted from inserted;

  if v_inserted > 0 then
    return query select * from public.configure_workspace_member_codes(p_owner_id, coalesce(v_format, 'alphanumeric'), coalesce(v_length, 3));
  else
    return query select * from public.workspace_member_codes where workspace_owner_id = p_owner_id order by ordinal;
  end if;
end;
$$;

revoke all on function public.ensure_workspace_member_codes(uuid, jsonb) from public, anon;
grant execute on function public.ensure_workspace_member_codes(uuid, jsonb) to authenticated;

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

  -- Keep all allocation semantics in the existing, advisory-locked allocator.
  -- Selecting the one matching row prevents a new member create from sending
  -- every workspace assignment back through the client.
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

notify pgrst, 'reload schema';
