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
  v_format text := 'alphanumeric';
  v_length smallint := 3;
  v_next_ordinal bigint := 0;
  v_candidate text;
  v_prefix text;
  v_suffix bigint;
  v_width integer;
  v_member record;
begin
  perform public.authorize_workspace_actor(p_owner_id);
  perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));

  select
    coalesce(member_code_format, 'alphanumeric'),
    coalesce(member_code_length, 3)::smallint
  into v_format, v_length
  from public.user_preferences
  where user_id = p_owner_id;

  v_format := coalesce(v_format, 'alphanumeric');
  v_length := coalesce(v_length, 3::smallint);

  select coalesce(max(ordinal), 0)
  into v_next_ordinal
  from public.workspace_member_codes
  where workspace_owner_id = p_owner_id;

  for v_member in
    select distinct on (member_id)
      member_id,
      legacy_code
    from (
      select
        nullif(value ->> 'id', '')::uuid as member_id,
        upper(regexp_replace(coalesce(value ->> 'legacy_code', ''), '[^A-Za-z0-9]', '', 'g')) as legacy_code
      from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
    ) incoming
    where member_id is not null
    order by member_id, legacy_code
  loop
    if exists (
      select 1
      from public.workspace_member_codes existing
      where existing.workspace_owner_id = p_owner_id
        and existing.member_id = v_member.member_id
    ) then
      continue;
    end if;

    v_next_ordinal := v_next_ordinal + 1;

    if v_format = 'letters' then
      v_candidate := public.member_code_letters(v_next_ordinal, v_length);
    elsif v_format = 'numbers' then
      v_width := greatest(v_length::integer, length(v_next_ordinal::text));
      v_candidate := lpad(v_next_ordinal::text, v_width, '0');
    else
      v_prefix := coalesce(nullif(substring(v_member.legacy_code from '^[A-Z]'), ''), 'A');

      select coalesce(max((substring(current_code from '^[A-Z]([0-9]+)$'))::bigint), 0)
      into v_suffix
      from public.workspace_member_codes
      where workspace_owner_id = p_owner_id
        and current_code ~ ('^' || v_prefix || '[0-9]+$');

      v_suffix := v_suffix + 1;
      loop
        v_width := greatest((v_length - 1)::integer, length(v_suffix::text));
        v_candidate := v_prefix || lpad(v_suffix::text, v_width, '0');
        exit when not exists (
          select 1
          from public.workspace_member_codes collision
          where collision.workspace_owner_id = p_owner_id
            and collision.current_code = v_candidate
        );
        v_suffix := v_suffix + 1;
      end loop;
    end if;

    insert into public.workspace_member_codes (
      workspace_owner_id,
      member_id,
      ordinal,
      legacy_code,
      current_code,
      aliases,
      created_at,
      updated_at
    ) values (
      p_owner_id,
      v_member.member_id,
      v_next_ordinal,
      coalesce(v_member.legacy_code, ''),
      v_candidate,
      case
        when coalesce(v_member.legacy_code, '') <> '' and upper(v_member.legacy_code) <> upper(v_candidate)
          then array[upper(v_member.legacy_code)]::text[]
        else '{}'::text[]
      end,
      now(),
      now()
    )
    on conflict (workspace_owner_id, member_id) do nothing;
  end loop;

  return query
  select assignment.*
  from public.workspace_member_codes assignment
  where assignment.workspace_owner_id = p_owner_id
    and assignment.member_id in (
      select distinct nullif(value ->> 'id', '')::uuid
      from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
      where nullif(value ->> 'id', '') is not null
    )
  order by assignment.ordinal;
end;
$$;

revoke all on function public.ensure_workspace_member_codes(uuid, jsonb) from public, anon;
grant execute on function public.ensure_workspace_member_codes(uuid, jsonb) to authenticated;

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

  select assignment.*
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
