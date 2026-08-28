-- Workspace-wide canonical member codes. This is intentionally independent of
-- client ordering so concurrent collaborators cannot allocate the same code.

alter table public.user_preferences
  add column if not exists member_code_format text not null default 'alphanumeric';

-- Some early DatSer projects predate this helper. Keep the Member Codes
-- access contract self-contained so owners and active collaborators share
-- one authoritative workspace format.
create or replace function public.can_access_workspace(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_owner_id is not null
    and (
      auth.uid() = p_owner_id
      or exists (
        select 1
        from public.collaborators collaborator
        where collaborator.owner_id = p_owner_id
          and collaborator.status in ('accepted', 'active')
          and (
            collaborator.collaborator_user_id = auth.uid()
            or exists (
              select 1
              from auth.users account
              where account.id = auth.uid()
                and (
                  collaborator.email = account.email
                  or collaborator.email ilike account.email
                )
            )
          )
      )
    );
$$;

alter table public.user_preferences
  drop constraint if exists user_preferences_member_code_format_check;
alter table public.user_preferences
  add constraint user_preferences_member_code_format_check
  check (member_code_format in ('alphanumeric', 'letters', 'numbers'));

create table if not exists public.workspace_member_codes (
  workspace_owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null,
  ordinal bigint not null check (ordinal > 0),
  legacy_code text not null check (legacy_code ~ '^[A-Z0-9]+$'),
  current_code text not null check (current_code ~ '^[A-Z0-9]+$'),
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_owner_id, member_id),
  unique (workspace_owner_id, ordinal),
  unique (workspace_owner_id, current_code)
);

alter table public.workspace_member_codes
  add column if not exists ordinal bigint,
  add column if not exists legacy_code text,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.workspace_member_codes
  drop constraint if exists workspace_member_codes_current_code_check;
alter table public.workspace_member_codes
  add constraint workspace_member_codes_current_code_check
  -- Underscores are used only for a temporary in-transaction conversion key;
  -- public responses always contain normalized A-Z/0-9 member codes.
  check (current_code ~ '^[A-Z0-9_]+$');

with ordered as (
  select workspace_owner_id, member_id,
    row_number() over (partition by workspace_owner_id order by created_at, member_id)::bigint as generated_ordinal
  from public.workspace_member_codes
  where ordinal is null
)
update public.workspace_member_codes code
set ordinal = ordered.generated_ordinal
from ordered
where code.workspace_owner_id = ordered.workspace_owner_id and code.member_id = ordered.member_id;

-- Existing installations did not retain an original alphanumeric display code.
-- Preserve their current code as the legacy fallback before enforcing the column.
update public.workspace_member_codes
set legacy_code = current_code
where legacy_code is null or legacy_code = '';

alter table public.workspace_member_codes
  alter column ordinal set not null,
  alter column legacy_code set not null;

create or replace function public.member_code_letters(p_ordinal bigint)
returns text language plpgsql immutable as $$
declare v_value bigint := p_ordinal; v_code text := '';
begin
  if v_value is null or v_value < 1 then raise exception 'Member-code ordinal must be positive'; end if;
  while v_value > 0 loop
    v_value := v_value - 1;
    v_code := chr(65 + (v_value % 26)::integer) || v_code;
    v_value := floor(v_value / 26.0);
  end loop;
  return v_code;
end;
$$;

create or replace function public.member_code_for_format(p_format text, p_ordinal bigint, p_legacy_code text default null)
returns text language plpgsql immutable as $$
begin
  if p_format = 'letters' then return public.member_code_letters(p_ordinal); end if;
  if p_format = 'numbers' then
    -- Pad through 999, then keep growing instead of truncating 1000 to 100.
    return case when p_ordinal < 1000 then lpad(p_ordinal::text, 3, '0') else p_ordinal::text end;
  end if;
  return upper(regexp_replace(coalesce(nullif(p_legacy_code, ''), 'M' || lpad(p_ordinal::text, 4, '0')), '[^A-Za-z0-9]', '', 'g'));
end;
$$;

create or replace function public.member_code_format_admin(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = p_owner_id or exists (
    select 1 from public.collaborators c
    where c.owner_id = p_owner_id and c.collaborator_user_id = auth.uid()
      and c.status in ('active', 'accepted') and coalesce(c.is_admin, false)
  );
$$;

alter table public.workspace_member_codes enable row level security;
drop policy if exists workspace_member_codes_read on public.workspace_member_codes;
create policy workspace_member_codes_read on public.workspace_member_codes
  for select to authenticated using (public.can_access_workspace(workspace_owner_id));

-- Adds all known members with a locked next ordinal. p_members only supplies a
-- legacy display fallback; the database assigns ordinal and uniqueness itself.
create or replace function public.ensure_workspace_member_codes(p_owner_id uuid, p_members jsonb)
returns setof public.workspace_member_codes language plpgsql security definer set search_path = public as $$
declare v_format text; v_next bigint; v_member jsonb; v_member_id uuid; v_legacy text;
begin
  if not public.member_code_format_admin(p_owner_id) then raise exception 'Only a workspace owner or admin collaborator can allocate member codes'; end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));
  select coalesce(member_code_format, 'alphanumeric') into v_format from public.user_preferences where user_id = p_owner_id;
  v_format := coalesce(v_format, 'alphanumeric');
  select coalesce(max(ordinal), 0) + 1 into v_next from public.workspace_member_codes where workspace_owner_id = p_owner_id;
  for v_member in select value from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) loop
    v_member_id := nullif(v_member ->> 'id', '')::uuid;
    v_legacy := upper(regexp_replace(coalesce(v_member ->> 'legacy_code', ''), '[^A-Za-z0-9]', '', 'g'));
    if v_member_id is null or exists (select 1 from public.workspace_member_codes where workspace_owner_id = p_owner_id and member_id = v_member_id) then continue; end if;
    insert into public.workspace_member_codes (workspace_owner_id, member_id, ordinal, legacy_code, current_code)
    values (p_owner_id, v_member_id, v_next, v_legacy, public.member_code_for_format(v_format, v_next, v_legacy));
    v_next := v_next + 1;
  end loop;
  return query select * from public.workspace_member_codes where workspace_owner_id = p_owner_id order by ordinal;
end;
$$;

-- Conversion is a single transaction: all codes are staged, aliases are kept,
-- and the authoritative workspace preference moves only after every row updates.
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

  -- Move every active value out of the public namespace first. This makes the
  -- next phase safe even if a previous/legacy alphanumeric value collides.
  update public.workspace_member_codes code
  set aliases = array(
        select distinct upper(value)
        from unnest(code.aliases || array[code.current_code]) as value
        where value is not null and value <> ''
      ),
      current_code = '__TEMP__' || ordinal::text,
      updated_at = now()
  where workspace_owner_id = p_owner_id;

  -- Assign deterministically one at a time. Letter and number formats are
  -- naturally unique by ordinal. Alphanumeric legacy values may not be, so
  -- append a stable suffix only when an existing legacy value conflicts.
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

  -- An alias must never shadow another member's active code in this workspace.
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
alter table public.workspace_member_codes replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_rel publication_rel
      join pg_publication publication on publication.oid = publication_rel.prpubid
      where publication.pubname = 'supabase_realtime'
        and publication_rel.prrelid = 'public.workspace_member_codes'::regclass
    ) then
    alter publication supabase_realtime add table public.workspace_member_codes;
  end if;
end;
$$;

revoke all on function public.member_code_format_admin(uuid) from public, anon;
revoke all on function public.ensure_workspace_member_codes(uuid, jsonb) from public, anon;
revoke all on function public.convert_workspace_member_code_format(uuid, text) from public, anon;
revoke all on function public.can_access_workspace(uuid) from public, anon;
revoke all on function public.member_code_letters(bigint) from public, anon;
revoke all on function public.member_code_for_format(text, bigint, text) from public, anon;
grant execute on function public.member_code_letters(bigint) to authenticated;
grant execute on function public.member_code_for_format(text, bigint, text) to authenticated;
grant execute on function public.member_code_format_admin(uuid) to authenticated;
grant execute on function public.ensure_workspace_member_codes(uuid, jsonb) to authenticated;
grant execute on function public.convert_workspace_member_code_format(uuid, text) to authenticated;
grant execute on function public.can_access_workspace(uuid) to authenticated;

comment on table public.workspace_member_codes is 'Canonical workspace member codes with retained aliases. Recovery: revert member_code_format and re-run conversion after correcting assignments.';

notify pgrst, 'reload schema';
