-- Authoritative fixed-width workspace member-code configuration. The server
-- performs one locked, set-based conversion so collaborators never race or
-- receive a partially converted code set.

alter table public.user_preferences
  add column if not exists member_code_length smallint;

update public.user_preferences
set member_code_length = 3
where member_code_length is null;

alter table public.user_preferences
  alter column member_code_length set default 3,
  alter column member_code_length set not null;

alter table public.user_preferences
  drop constraint if exists user_preferences_member_code_length_check;
alter table public.user_preferences
  add constraint user_preferences_member_code_length_check
  check (member_code_length between 3 and 6);

create index if not exists workspace_member_codes_owner_ordinal_idx
  on public.workspace_member_codes (workspace_owner_id, ordinal);

create or replace function public.member_code_letters(p_ordinal bigint, p_code_length smallint)
returns text language plpgsql immutable as $$
declare
  v_value bigint := p_ordinal - 1;
  v_length integer := p_code_length;
  v_code text := '';
  v_index integer;
begin
  if v_length not between 3 and 6 then raise exception 'Member-code length must be between 3 and 6'; end if;
  if p_ordinal is null or p_ordinal < 1 or p_ordinal > power(26::numeric, v_length)::bigint then
    raise exception 'Member-code ordinal is outside the selected letter capacity';
  end if;
  for v_index in 1..v_length loop
    v_code := chr(65 + (v_value % 26)::integer) || v_code;
    v_value := v_value / 26;
  end loop;
  return v_code;
end;
$$;

create or replace function public.member_code_letters(p_ordinal bigint)
returns text language sql immutable as $$
  select public.member_code_letters(p_ordinal, 3::smallint);
$$;

create or replace function public.member_code_for_format(p_format text, p_ordinal bigint, p_legacy_code text, p_code_length smallint)
returns text language plpgsql immutable as $$
declare
  v_length integer := p_code_length;
  v_number_capacity bigint := power(10::numeric, p_code_length)::bigint - 1;
  v_alpha_suffix_capacity bigint := power(10::numeric, p_code_length - 1)::bigint - 1;
  v_prefix_index bigint;
  v_suffix bigint;
begin
  if p_format not in ('alphanumeric', 'letters', 'numbers') then raise exception 'Unsupported member-code format'; end if;
  if v_length not between 3 and 6 then raise exception 'Member-code length must be between 3 and 6'; end if;
  if p_ordinal is null or p_ordinal < 1 then raise exception 'Member-code ordinal must be positive'; end if;
  if p_format = 'letters' then return public.member_code_letters(p_ordinal, p_code_length); end if;
  if p_format = 'numbers' then
    if p_ordinal > v_number_capacity then raise exception 'Selected Numbers Only length cannot hold this workspace'; end if;
    return lpad(p_ordinal::text, v_length, '0');
  end if;
  if p_ordinal > 26 * v_alpha_suffix_capacity then raise exception 'Selected Letters + Numbers length cannot hold this workspace'; end if;
  v_prefix_index := (p_ordinal - 1) / v_alpha_suffix_capacity;
  v_suffix := ((p_ordinal - 1) % v_alpha_suffix_capacity) + 1;
  return chr(65 + v_prefix_index::integer) || lpad(v_suffix::text, v_length - 1, '0');
end;
$$;

create or replace function public.member_code_for_format(p_format text, p_ordinal bigint, p_legacy_code text default null)
returns text language sql immutable as $$
  select public.member_code_for_format(p_format, p_ordinal, p_legacy_code, 3::smallint);
$$;

create or replace function public.configure_workspace_member_codes(
  p_owner_id uuid,
  p_format text,
  p_code_length smallint
)
returns setof public.workspace_member_codes
language plpgsql security definer set search_path = public as $$
declare
  v_format text := coalesce(p_format, 'alphanumeric');
  v_length smallint := coalesce(p_code_length, 3);
  v_member_count bigint;
  v_capacity numeric;
  v_alpha_suffix_capacity bigint := power(10::numeric, coalesce(p_code_length, 3) - 1)::bigint - 1;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if v_format not in ('alphanumeric', 'letters', 'numbers') then raise exception 'Unsupported member-code format'; end if;
  if v_length not between 3 and 6 then raise exception 'Member-code length must be between 3 and 6'; end if;
  if not public.member_code_format_admin(p_owner_id) then
    raise exception 'Only the workspace owner or an admin collaborator can convert member codes';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));
  select count(*) into v_member_count from public.workspace_member_codes where workspace_owner_id = p_owner_id;
  v_capacity := case v_format
    when 'letters' then power(26::numeric, v_length)
    when 'numbers' then power(10::numeric, v_length) - 1
    else 26 * (power(10::numeric, v_length - 1) - 1)
  end;
  if v_member_count > v_capacity then
    raise exception 'This workspace has % members; the selected % format at length % supports only % codes. Choose a longer code length.', v_member_count, v_format, v_length, v_capacity;
  end if;
  if v_format = 'alphanumeric' and exists (
    select 1
    from (
      select coalesce(nullif(substring(upper(legacy_code) from '^[A-Z]'), ''), '#') as prefix,
        count(*) as member_count
      from public.workspace_member_codes
      where workspace_owner_id = p_owner_id
      group by 1
    ) grouped
    where grouped.member_count > v_alpha_suffix_capacity
  ) then
    raise exception 'A member-code prefix group is too large for the selected Letters + Numbers length. Select a longer code length.';
  end if;

  -- Free current-code uniqueness once, retain aliases, then allocate all final
  -- values in one set-based update. txid prevents staging values from touching
  -- any normal display code.
  update public.workspace_member_codes code
  set aliases = array(
        select distinct upper(value)
        from unnest(coalesce(code.aliases, '{}'::text[]) || array[code.current_code]) as value
        where value is not null and value <> ''
      ),
      current_code = '__RECODE__' || txid_current()::text || '_' || code.ordinal::text,
      updated_at = now()
  where code.workspace_owner_id = p_owner_id;

  with assigned as (
    select code.member_id,
      case v_format
        when 'letters' then public.member_code_letters(code.ordinal, v_length)
        when 'numbers' then lpad(code.ordinal::text, v_length, '0')
        else coalesce(
          nullif(substring(upper(code.legacy_code) from '^[A-Z]'), ''),
          chr(65 + ((code.ordinal - 1) / v_alpha_suffix_capacity)::integer)
        ) || lpad(
          row_number() over (
            partition by coalesce(
              nullif(substring(upper(code.legacy_code) from '^[A-Z]'), ''),
              chr(65 + ((code.ordinal - 1) / v_alpha_suffix_capacity)::integer)
            )
            order by code.ordinal
          )::text,
          v_length - 1,
          '0'
        )
      end as current_code
    from public.workspace_member_codes code
    where code.workspace_owner_id = p_owner_id
  )
  update public.workspace_member_codes code
  set current_code = assigned.current_code,
      updated_at = now()
  from assigned
  where code.workspace_owner_id = p_owner_id
    and code.member_id = assigned.member_id;

  -- Aliases can resolve historic codes, but cannot shadow someone else's
  -- current code in the same workspace.
  update public.workspace_member_codes code
  set aliases = coalesce(array(
    select distinct upper(alias)
    from unnest(coalesce(code.aliases, '{}'::text[])) as alias
    where alias <> code.current_code
      and not exists (
        select 1 from public.workspace_member_codes active
        where active.workspace_owner_id = code.workspace_owner_id
          and active.member_id <> code.member_id
          and active.current_code = upper(alias)
      )
  ), '{}'::text[])
  where code.workspace_owner_id = p_owner_id;

  insert into public.user_preferences (user_id, member_code_format, member_code_length, updated_at)
  values (p_owner_id, v_format, v_length, now())
  on conflict (user_id) do update
    set member_code_format = excluded.member_code_format,
        member_code_length = excluded.member_code_length,
        updated_at = excluded.updated_at;

  return query
  select * from public.workspace_member_codes
  where workspace_owner_id = p_owner_id
  order by ordinal;
end;
$$;

-- Keep existing callers working while routing them through the length-aware,
-- transactional configuration function.
create or replace function public.convert_workspace_member_code_format(p_owner_id uuid, p_format text)
returns setof public.workspace_member_codes
language plpgsql security definer set search_path = public as $$
declare v_length smallint;
begin
  select coalesce(member_code_length, 3)::smallint into v_length
  from public.user_preferences where user_id = p_owner_id;
  return query select * from public.configure_workspace_member_codes(p_owner_id, p_format, coalesce(v_length, 3));
end;
$$;

create or replace function public.ensure_workspace_member_codes(p_owner_id uuid, p_members jsonb)
returns setof public.workspace_member_codes
language plpgsql security definer set search_path = public as $$
declare
  v_format text;
  v_length smallint;
  v_next bigint;
  v_inserted bigint;
begin
  if auth.uid() is null or not public.member_code_format_admin(p_owner_id) then
    raise exception 'Only a workspace owner or admin collaborator can allocate member codes';
  end if;
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

alter table public.user_preferences replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_rel publication_rel
      join pg_publication publication on publication.oid = publication_rel.prpubid
      where publication.pubname = 'supabase_realtime'
        and publication_rel.prrelid = 'public.user_preferences'::regclass
    ) then
    alter publication supabase_realtime add table public.user_preferences;
  end if;
end;
$$;

revoke all on function public.configure_workspace_member_codes(uuid, text, smallint) from public, anon;
revoke all on function public.member_code_letters(bigint, smallint) from public, anon;
revoke all on function public.member_code_for_format(text, bigint, text, smallint) from public, anon;
grant execute on function public.configure_workspace_member_codes(uuid, text, smallint) to authenticated;
grant execute on function public.member_code_letters(bigint, smallint) to authenticated;
grant execute on function public.member_code_for_format(text, bigint, text, smallint) to authenticated;
grant execute on function public.convert_workspace_member_code_format(uuid, text) to authenticated;
grant execute on function public.ensure_workspace_member_codes(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';;
