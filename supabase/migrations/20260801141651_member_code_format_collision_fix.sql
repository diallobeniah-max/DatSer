-- Repair the initial format conversion so a workspace with duplicate legacy
-- alphanumeric codes can always return to its default format safely.
--
-- The first migration stages active codes before converting. This replacement
-- also resolves duplicate legacy values deterministically, rather than letting
-- the workspace_owner_id/current_code unique constraint abort the transaction.

create or replace function public.convert_workspace_member_code_format(p_owner_id uuid, p_format text)
returns setof public.workspace_member_codes language plpgsql security definer set search_path = public as $$
declare
  v_format text := coalesce(p_format, 'alphanumeric');
  v_code record;
  v_base text;
  v_candidate text;
  v_suffix bigint;
  v_allocated text[] := '{}';
begin
  if v_format not in ('alphanumeric', 'letters', 'numbers') then raise exception 'Unsupported member-code format'; end if;
  if not public.member_code_format_admin(p_owner_id) then raise exception 'Only a workspace owner or admin collaborator can convert member codes'; end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));

  update public.workspace_member_codes code
  set aliases = array(
        select distinct upper(value)
        from unnest(code.aliases || array[code.current_code]) as value
        where value is not null and value <> ''
      ),
      current_code = '__TEMP__' || ordinal::text,
      updated_at = now()
  where workspace_owner_id = p_owner_id;

  for v_code in
    select member_id, ordinal, legacy_code
    from public.workspace_member_codes
    where workspace_owner_id = p_owner_id
    order by ordinal
  loop
    v_base := public.member_code_for_format(v_format, v_code.ordinal, v_code.legacy_code);
    v_candidate := v_base;
    v_suffix := 0;
    while v_candidate = any(v_allocated) loop
      v_suffix := v_suffix + 1;
      v_candidate := v_base || case when v_suffix = 1 then v_code.ordinal::text else (v_code.ordinal::text || v_suffix::text) end;
    end loop;

    update public.workspace_member_codes
    set current_code = v_candidate,
        updated_at = now()
    where workspace_owner_id = p_owner_id
      and member_id = v_code.member_id;
    v_allocated := array_append(v_allocated, v_candidate);
  end loop;

  update public.workspace_member_codes code
  set aliases = array(
    select distinct alias
    from unnest(code.aliases) as alias
    where alias <> code.current_code
      and not exists (
        select 1
        from public.workspace_member_codes active
        where active.workspace_owner_id = code.workspace_owner_id
          and active.member_id <> code.member_id
          and active.current_code = alias
      )
  )
  where code.workspace_owner_id = p_owner_id;

  insert into public.user_preferences (user_id, member_code_format, updated_at)
  values (p_owner_id, v_format, now())
  on conflict (user_id) do update
    set member_code_format = excluded.member_code_format,
        updated_at = excluded.updated_at;
  return query select * from public.workspace_member_codes where workspace_owner_id = p_owner_id order by ordinal;
end;
$$;

grant execute on function public.convert_workspace_member_code_format(uuid, text) to authenticated;

notify pgrst, 'reload schema';

;
