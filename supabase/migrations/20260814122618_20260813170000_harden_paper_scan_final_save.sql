-- Paper Scan Final Save hardening. PREPARED ONLY: do not apply from Codex.
--
-- This migration deliberately treats user_month_tables as an informational UI
-- index only.  The mapping used by every mutation is workspace_month_tables,
-- which is populated from server-visible month tables during this migration and
-- never from a browser-supplied table name.

alter table public.paper_scan_saved add column if not exists save_result jsonb;
alter table public.paper_scan_saved alter column save_result drop not null;
alter table public.paper_scan_saved alter column save_result drop default;
update public.paper_scan_saved set save_result = null where save_result = '{}'::jsonb;

create table if not exists public.workspace_month_tables (
  owner_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  table_name text not null check (table_name = to_char(month_start, 'FMMonth_YYYY')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (owner_id, month_start)
);

-- Month tables are shared physical relations in existing DatSer installations,
-- so the same derived table name can legitimately map to many workspaces.
alter table public.workspace_month_tables drop constraint if exists workspace_month_tables_table_name_key;
create index if not exists workspace_month_tables_table_name_idx
  on public.workspace_month_tables(table_name);
alter table public.workspace_month_tables enable row level security;

create or replace function public.require_permanent_workspace_actor(
  p_owner_id uuid,
  p_require_admin boolean default false
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A permanent authenticated user is required' using errcode = '42501';
  end if;
  if p_owner_id is null then
    raise exception 'Workspace owner is required' using errcode = '22023';
  end if;
  if v_actor = p_owner_id then
    return v_actor;
  end if;
  if exists (
    select 1
    from public.collaborators c
    where c.owner_id = p_owner_id
      and c.status in ('accepted', 'active')
      and (c.collaborator_user_id = v_actor
        or lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
      and (not p_require_admin or coalesce(c.is_admin, false))
  ) then
    return v_actor;
  end if;
  raise exception 'Not authorized for this workspace' using errcode = '42501';
end;
$$;
revoke all on function public.require_permanent_workspace_actor(uuid, boolean) from public, anon;
grant execute on function public.require_permanent_workspace_actor(uuid, boolean) to authenticated;

create or replace function public.has_permanent_workspace_access(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and (auth.uid() = p_owner_id or exists (
      select 1 from public.collaborators c
      where c.owner_id = p_owner_id
        and c.status in ('accepted', 'active')
        and (c.collaborator_user_id = auth.uid()
          or lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    ));
$$;
revoke all on function public.has_permanent_workspace_access(uuid) from public, anon;
grant execute on function public.has_permanent_workspace_access(uuid) to authenticated;

-- A row's author is not its workspace provenance: an active collaborator can
-- belong to multiple workspaces.  The only row-level workspace boundary used
-- by this migration is immutable workspace_owner_id.  Legacy rows receive it
-- only when the existing server-owned canonical-code ledger has exactly one
-- workspace assignment for that member; otherwise they stay NULL and all
-- privileged Final Save/cross-month paths fail closed.
drop function if exists public.workspace_member_user_in_owner(uuid, uuid);

create or replace function public.assert_month_workspace_provenance()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.workspace_owner_id is null then
      raise exception 'workspace_owner_id is required for new month-table rows' using errcode = '42501';
    end if;
    perform public.require_permanent_workspace_actor(new.workspace_owner_id, false);
  elsif new.workspace_owner_id is distinct from old.workspace_owner_id then
    raise exception 'workspace_owner_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.assert_month_workspace_provenance() from public, anon, authenticated;

create or replace function public.harden_month_workspace_provenance(p_table_name text)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'
     or to_regclass(format('public.%I', p_table_name)) is null then
    raise exception 'Invalid canonical month table' using errcode = '22023';
  end if;
  execute format('alter table public.%I add column if not exists workspace_owner_id uuid references auth.users(id)', p_table_name);
  execute format('create index if not exists %I on public.%I(workspace_owner_id, id)',
    p_table_name || '_workspace_owner_member_idx', p_table_name);
end;
$$;
revoke all on function public.harden_month_workspace_provenance(text) from public, anon, authenticated;

create or replace function public.lock_month_workspace_provenance(p_table_name text)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_trigger text;
begin
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'
     or to_regclass(format('public.%I', p_table_name)) is null then
    raise exception 'Invalid canonical month table' using errcode = '22023';
  end if;
  v_trigger := p_table_name || '_workspace_owner_immutable';
  execute format('drop trigger if exists %I on public.%I', v_trigger, p_table_name);
  execute format('create trigger %I before insert or update of workspace_owner_id on public.%I for each row execute function public.assert_month_workspace_provenance()',
    v_trigger, p_table_name);
end;
$$;
revoke all on function public.lock_month_workspace_provenance(text) from public, anon, authenticated;

drop policy if exists "workspace month registry read" on public.workspace_month_tables;
create policy "workspace month registry read" on public.workspace_month_tables
  for select to authenticated using (public.has_permanent_workspace_access(owner_id));
revoke all on public.workspace_month_tables from public, anon, authenticated;
grant select on public.workspace_month_tables to authenticated;

-- Internal capability helpers.  Their table values always originate in the
-- server-owned registry; neither helper is granted to a browser role.
create or replace function public.month_table_has_column(p_table_name text, p_column_name text)
returns boolean language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table_name and column_name = p_column_name
  );
$$;
revoke all on function public.month_table_has_column(text, text) from public, anon, authenticated;

create or replace function public.workspace_month_table_for(p_owner_id uuid, p_month_start date)
returns text language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_table text;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'Invalid logical month' using errcode = '22023';
  end if;
  select table_name into v_table
  from public.workspace_month_tables
  where owner_id = p_owner_id and month_start = p_month_start;
  if v_table is null or to_regclass(format('public.%I', v_table)) is null then
    raise exception 'This logical month is not registered for the workspace' using errcode = '42501';
  end if;
  if not public.month_table_has_column(v_table, 'workspace_owner_id') then
    raise exception 'This logical month lacks trusted workspace provenance' using errcode = '42501';
  end if;
  return v_table;
end;
$$;
revoke all on function public.workspace_month_table_for(uuid, date) from public, anon, authenticated;

-- Historical physical month tables are shared by multiple workspaces.  Do not
-- infer a table owner from user_month_tables, the legacy row actor, or current
-- collaborator membership.  The only automatic backfill evidence is a member
-- id that has exactly one server-owned workspace_member_codes owner.
create or replace function public.reconcile_month_member_workspace_provenance(p_table_name text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  if to_regclass('public.workspace_member_provenance_overrides') is null
     or to_regclass('public.workspace_member_provenance_exclusions') is null then
    raise exception 'Operator-verified provenance overrides and exclusions must be prepared before cutover' using errcode = 'P0001';
  end if;
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'
     or to_regclass(format('public.%I', p_table_name)) is null
     or not public.month_table_has_column(p_table_name, 'id')
     or not public.month_table_has_column(p_table_name, 'workspace_owner_id') then
    raise exception 'Invalid canonical month table for provenance reconciliation' using errcode = '22023';
  end if;

  execute format(
    'with unique_code_owner as (
       select member_id, min(workspace_owner_id::text)::uuid as owner_id
       from public.workspace_member_codes
       group by member_id
       having count(distinct workspace_owner_id) = 1
     )
     update public.%I member_row
     set workspace_owner_id = evidence.owner_id
     from unique_code_owner evidence
     where member_row.id = evidence.member_id
       and member_row.workspace_owner_id is null',
    p_table_name
  );

  -- Explicit operator decisions are the only secondary evidence.  They are
  -- keyed by canonical UUID, therefore one decision fills every legitimate
  -- month copy, and never derives ownership from a legacy row actor.
  -- Defensively skips any canonical UUID present in workspace_member_provenance_exclusions.
  execute format(
    'update public.%I member_row
     set workspace_owner_id = override.workspace_owner_id
     from public.workspace_member_provenance_overrides override
     where member_row.id = override.member_id
       and member_row.workspace_owner_id is null
       and not exists (
         select 1
         from public.workspace_member_provenance_exclusions ex
         where ex.member_id = override.member_id
       )',
    p_table_name
  );

  -- Excluded rows are recorded in workspace_member_provenance_exclusions and
  -- NEVER receive a workspace_owner_id. Under RLS, rows with null workspace_owner_id
  -- remain invisible to normal workspace member queries.
  execute format(
    'with evidence as (
       select member_row.id,
              member_row.workspace_owner_id,
              count(distinct code.workspace_owner_id) as candidate_owner_count,
              min(code.workspace_owner_id::text)::uuid as candidate_owner,
              bool_or(ex.member_id is not null) as is_excluded
       from public.%I member_row
       left join public.workspace_member_codes code on code.member_id = member_row.id
       left join public.workspace_member_provenance_exclusions ex on ex.member_id = member_row.id
       group by member_row.id, member_row.workspace_owner_id
     )
     select jsonb_build_object(
       ''table_name'', %L,
       ''total'', count(*),
       ''proven'', count(*) filter (where workspace_owner_id is not null),
       ''excluded'', count(*) filter (where workspace_owner_id is null and is_excluded),
       ''unmapped'', count(*) filter (where workspace_owner_id is null and not is_excluded and candidate_owner_count = 0),
       ''ambiguous'', count(*) filter (where workspace_owner_id is null and not is_excluded and candidate_owner_count > 1),
       ''conflicts'', count(*) filter (where (workspace_owner_id is not null and candidate_owner_count = 1 and workspace_owner_id <> candidate_owner) or (workspace_owner_id is not null and is_excluded))
     )
     from evidence',
    p_table_name, p_table_name
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.reconcile_month_member_workspace_provenance(text) from public, anon, authenticated;

-- This guard runs after the deterministic backfill and before any strict
-- month-table RLS policy or legacy-RPC grant is changed.  It deliberately
-- aborts the entire migration rather than making an unresolved historic row
-- invisible.  The JSON error detail is an auditable, PII-free preflight report.
create or replace function public.assert_historic_member_provenance_cutover()
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r record;
  v_stats jsonb;
  v_total bigint := 0;
  v_proven bigint := 0;
  v_excluded bigint := 0;
  v_unmapped bigint := 0;
  v_ambiguous bigint := 0;
  v_conflicts bigint := 0;
  v_overlap bigint := 0;
begin
  -- Preflight: verify zero overlap between overrides and exclusions
  select count(*)
  into v_overlap
  from public.workspace_member_provenance_overrides o
  join public.workspace_member_provenance_exclusions e on e.member_id = o.member_id;

  if v_overlap > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Historic member provenance cutover blocked: canonical member exists in both overrides and exclusions',
      detail = jsonb_build_object('overlapping_members_count', v_overlap)::text,
      hint = 'A canonical member cannot simultaneously have an ownership override and an exclusion.';
  end if;

  for r in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
      and public.month_table_has_column(c.relname, 'id')
  loop
    v_stats := public.reconcile_month_member_workspace_provenance(r.table_name);
    v_total := v_total + coalesce((v_stats ->> 'total')::bigint, 0);
    v_proven := v_proven + coalesce((v_stats ->> 'proven')::bigint, 0);
    v_excluded := v_excluded + coalesce((v_stats ->> 'excluded')::bigint, 0);
    v_unmapped := v_unmapped + coalesce((v_stats ->> 'unmapped')::bigint, 0);
    v_ambiguous := v_ambiguous + coalesce((v_stats ->> 'ambiguous')::bigint, 0);
    v_conflicts := v_conflicts + coalesce((v_stats ->> 'conflicts')::bigint, 0);
  end loop;

  if v_unmapped <> 0 or v_ambiguous <> 0 or v_conflicts <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Historic member provenance cutover blocked',
      detail = jsonb_build_object(
        'total_rows', v_total,
        'proven_rows', v_proven,
        'quarantined_rows', v_excluded,
        'unmapped_rows', v_unmapped,
        'ambiguous_rows', v_ambiguous,
        'conflicting_rows', v_conflicts
      )::text,
      hint = 'Reconcile only rows with independently trusted workspace provenance, then rerun the migration.';
  end if;
end;
$$;
revoke all on function public.assert_historic_member_provenance_cutover() from public, anon, authenticated;

-- This is a migration/service-only reconciliation tool.  It has no browser
-- grant and accepts no caller assertions. It discovers only canonical
-- Month_YYYY relations, backfills immutable row provenance solely from the
-- server-owned canonical-code ledger, and never treats a row actor/user_id as
-- workspace ownership. Rows without exactly one proven owner remain NULL.
create or replace function public.reconcile_workspace_month_registry()
returns integer language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r record;
  v_month_start date;
  v_count integer := 0;
  v_inserted integer;
begin
  for r in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
      and exists (
        select 1 from information_schema.columns ic
        where ic.table_schema = 'public' and ic.table_name = c.relname and ic.column_name = 'id'
      )
  loop
    begin
      v_month_start := to_date(replace(r.table_name, '_', ' ') || ' 01', 'FMMonth YYYY DD');
      if to_char(v_month_start, 'FMMonth_YYYY') <> r.table_name then
        continue;
      end if;
      perform public.harden_month_workspace_provenance(r.table_name);
      perform public.reconcile_month_member_workspace_provenance(r.table_name);
      perform public.lock_month_workspace_provenance(r.table_name);
      execute format(
        'insert into public.workspace_month_tables(owner_id, month_start, table_name, created_by)
         select distinct workspace_owner_id, $1, $2, null::uuid
         from public.%I
         where workspace_owner_id is not null
         on conflict (owner_id, month_start) do update set table_name = excluded.table_name',
        r.table_name
      ) using v_month_start, r.table_name;
      get diagnostics v_inserted = row_count;
      v_count := v_count + v_inserted;
    exception when others then
      -- One malformed legacy relation cannot create a caller-controlled mapping
      -- or prevent legitimate relations from being reconciled.
      continue;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.reconcile_workspace_month_registry() from public, anon, authenticated;

-- Run once as the migration owner.  Future New Month writes register their
-- mapping atomically; ordinary clients cannot invoke this bootstrap function.
select public.reconcile_workspace_month_registry();

-- Never make a historic member disappear behind strict RLS.  Any unresolved
-- or contradictory provenance aborts this still-unapplied migration before
-- the policy/grant cutover below can commit.
select public.assert_historic_member_provenance_cutover();

create or replace function public.ensure_workspace_month_registration(
  p_owner_id uuid, p_month_start date
) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_table text;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'Invalid logical month' using errcode = '22023';
  end if;
  select table_name into v_table from public.workspace_month_tables
  where owner_id = p_owner_id and month_start = p_month_start;
  if v_table is null then
    raise exception 'Logical month is not registered for this workspace' using errcode = '42501';
  end if;
  if to_regclass(format('public.%I', v_table)) is null then
    raise exception 'Registered logical month no longer exists' using errcode = '42P01';
  end if;
  if not public.month_table_has_column(v_table, 'workspace_owner_id') then
    raise exception 'Registered logical month lacks trusted workspace provenance' using errcode = '42501';
  end if;
  return v_table;
end;
$$;
revoke all on function public.ensure_workspace_month_registration(uuid, date) from public, anon, authenticated;

-- Retire raw browser DDL/copy endpoints.  The cross-month flow below is moved
-- to a logical-month RPC before this legacy endpoint is revoked.
drop function if exists public.insert_selected_members(text, text, uuid[]);
create function public.insert_selected_members(text, text, uuid[]) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin raise exception 'Deprecated: use create_workspace_month'; end; $$;
drop function if exists public.reset_month_members(text);
create function public.reset_month_members(text) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin raise exception 'Deprecated: use create_workspace_month'; end; $$;
drop function if exists public.add_attendance_column(text, text);
create function public.add_attendance_column(text, text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin raise exception 'Deprecated: use ensure_workspace_attendance_column'; end; $$;
drop function if exists public.create_month_from_current(text, text, text[]);
create function public.create_month_from_current(text, text, text[]) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin raise exception 'Deprecated: use create_workspace_month'; end; $$;
revoke all on function public.insert_selected_members(text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.reset_month_members(text) from public, anon, authenticated;
revoke all on function public.add_attendance_column(text, text) from public, anon, authenticated;
revoke all on function public.create_month_from_current(text, text, text[]) from public, anon, authenticated;

create or replace function public.create_workspace_month(
  p_owner_id uuid, p_year integer, p_month integer, p_source_month date,
  p_copy_mode text, p_member_ids uuid[] default array[]::uuid[]
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_target_month date;
  v_target text;
  v_source text;
  v_copied integer := 0;
  v_target_exists boolean;
  v_source_has_deleted boolean;
  v_copy_filter text;
begin
  v_actor := public.require_permanent_workspace_actor(p_owner_id, true);
  if p_year not between 2000 and 2200 or p_month not between 1 and 12
     or p_copy_mode not in ('all', 'custom', 'empty') then
    raise exception 'Invalid logical month request' using errcode = '22023';
  end if;
  if p_copy_mode <> 'empty' then
    if p_source_month is null or p_source_month <> date_trunc('month', p_source_month)::date then
      raise exception 'A source logical month is required' using errcode = '22023';
    end if;
  else
    if p_source_month is not null and p_source_month <> date_trunc('month', p_source_month)::date then
      raise exception 'Invalid source logical month' using errcode = '22023';
    end if;
  end if;
  v_target_month := make_date(p_year, p_month, 1);
  v_target := to_char(v_target_month, 'FMMonth_YYYY');
  if exists (select 1 from public.workspace_month_tables where owner_id = p_owner_id and month_start = v_target_month) then
    raise exception 'Month already exists for this workspace' using errcode = '23505';
  end if;
  if p_source_month is not null then
    v_source := public.ensure_workspace_month_registration(p_owner_id, p_source_month);
  else
    select table_name into v_source
    from public.workspace_month_tables
    where owner_id = p_owner_id
    order by month_start desc
    limit 1;
  end if;
  v_target_exists := to_regclass(format('public.%I', v_target)) is not null;
  if not v_target_exists then
    if v_source is not null and to_regclass(format('public.%I', v_source)) is not null then
      execute format('create table public.%I (like public.%I including all)', v_target, v_source);
    else
      execute format('create table public.%I (like public."January_2026" including all)', v_target);
    end if;
    execute format('alter table public.%I enable row level security', v_target);
    execute format(
      'create policy %I on public.%I for all to authenticated
       using (public.has_permanent_workspace_access(workspace_owner_id))
       with check (public.has_permanent_workspace_access(workspace_owner_id))',
      v_target || '_workspace', v_target
    );
  end if;
  perform public.harden_month_workspace_provenance(v_target);
  perform public.lock_month_workspace_provenance(v_target);
  insert into public.workspace_month_tables(owner_id, month_start, table_name, created_by)
  values (p_owner_id, v_target_month, v_target, v_actor);
  if p_copy_mode <> 'empty' then
    v_source_has_deleted := public.month_table_has_column(v_source, 'deleted_at');
    v_copy_filter := 'workspace_owner_id = $1' || case when v_source_has_deleted then ' and deleted_at is null' else '' end;
    if p_copy_mode = 'all' then
      execute format('insert into public.%I select * from public.%I where %s on conflict (id) do nothing', v_target, v_source, v_copy_filter)
        using p_owner_id;
    elsif cardinality(p_member_ids) > 0 then
      execute format('insert into public.%I select * from public.%I where %s and id = any($2) on conflict (id) do nothing', v_target, v_source, v_copy_filter)
        using p_owner_id, p_member_ids;
    end if;
    get diagnostics v_copied = row_count;
  end if;
  -- Kept only as a UI index after the server-owned mapping has succeeded.
  insert into public.user_month_tables(user_id, table_name, month_year)
  values (p_owner_id, v_target, to_char(v_target_month, 'FMMonth YYYY'))
  on conflict (user_id, table_name) do update set month_year = excluded.month_year;
  return jsonb_build_object('success', true, 'table_name', v_target, 'members_copied', v_copied);
end;
$$;
revoke all on function public.create_workspace_month(uuid, integer, integer, date, text, uuid[]) from public, anon;
grant execute on function public.create_workspace_month(uuid, integer, integer, date, text, uuid[]) to authenticated;

create or replace function public.ensure_workspace_attendance_column(
  p_owner_id uuid, p_month_start date, p_attendance_date date
) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_table text; v_column text;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_attendance_date is null or extract(isodow from p_attendance_date) <> 7
     or date_trunc('month', p_attendance_date)::date <> p_month_start then
    raise exception 'Attendance must be a Sunday in the requested logical month' using errcode = '22023';
  end if;
  v_table := public.workspace_month_table_for(p_owner_id, p_month_start);
  v_column := 'attendance_' || to_char(p_attendance_date, 'YYYY_MM_DD');
  execute format('alter table public.%I add column if not exists %I text', v_table, v_column);
  return v_column;
end;
$$;
revoke all on function public.ensure_workspace_attendance_column(uuid, date, date) from public, anon;
grant execute on function public.ensure_workspace_attendance_column(uuid, date, date) to authenticated;

-- Replace the cross-month path with logical month inputs.  The browser no
-- longer chooses a physical relation or attendance column.
drop function if exists public.set_member_attendance_from_other_month(uuid, text, text, uuid, date, text, text);
drop function if exists public.set_member_attendance_from_other_month(uuid, date, date, uuid, date, text, text);
create function public.set_member_attendance_from_other_month(
  p_owner_id uuid, p_source_month date, p_target_month date, p_member_id uuid,
  p_attendance_date date, p_attendance_status text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_source text;
  v_target text;
  v_column text;
  v_source_member jsonb;
  v_target_exists boolean;
  v_target_deleted boolean := false;
  v_source_has_deleted boolean;
  v_target_has_deleted boolean;
  v_target_has_updated boolean;
  v_sql text;
  v_response jsonb;
  v_existing jsonb;
  v_reserved text;
  v_status text;
  v_assignment public.workspace_member_codes%rowtype;
begin
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_source_month is null or p_source_month <> date_trunc('month', p_source_month)::date
     or p_target_month is null or p_target_month <> date_trunc('month', p_target_month)::date
     or p_member_id is null or nullif(btrim(p_request_id), '') is null then
    raise exception 'Invalid cross-month attendance request' using errcode = '22023';
  end if;
  if p_attendance_status not in ('Present', 'Absent') or extract(isodow from p_attendance_date) <> 7
     or date_trunc('month', p_attendance_date)::date <> p_target_month then
    raise exception 'Attendance must be an explicit Sunday in the target month' using errcode = '22023';
  end if;
  v_source := public.workspace_month_table_for(p_owner_id, p_source_month);
  v_target := public.workspace_month_table_for(p_owner_id, p_target_month);
  insert into public.member_mutation_idempotency(owner_id, table_name, operation_name, request_id, created_by, status, response)
  values (p_owner_id, v_target, 'set_member_attendance_from_other_month', p_request_id, v_actor, 'processing', null)
  on conflict (owner_id, table_name, operation_name, request_id) do nothing
  returning request_id into v_reserved;
  if v_reserved is null then
    select response into v_existing from public.member_mutation_idempotency
    where owner_id = p_owner_id and table_name = v_target
      and operation_name = 'set_member_attendance_from_other_month' and request_id = p_request_id;
    return coalesce(v_existing, jsonb_build_object('success', false, 'error_message', 'Duplicate request is still processing'));
  end if;
  begin
    v_source_has_deleted := public.month_table_has_column(v_source, 'deleted_at');
    v_target_has_deleted := public.month_table_has_column(v_target, 'deleted_at');
    v_target_has_updated := public.month_table_has_column(v_target, 'updated_at');
    v_sql := format('select to_jsonb(s.*) from public.%I s where s.id = $1 and s.workspace_owner_id = $2%s limit 1',
      v_source, case when v_source_has_deleted then ' and s.deleted_at is null' else '' end);
    execute v_sql into v_source_member using p_member_id, p_owner_id;
    if v_source_member is null then
      raise exception 'Active member is not present in the source workspace month';
    end if;
    v_column := public.ensure_workspace_attendance_column(p_owner_id, p_target_month, p_attendance_date);
    execute format('select exists(select 1 from public.%I where id=$1 and workspace_owner_id = $2)', v_target)
      into v_target_exists using p_member_id, p_owner_id;
    if v_target_exists then
      if v_target_has_deleted then
        execute format('select exists(select 1 from public.%I where id=$1 and workspace_owner_id = $2 and deleted_at is not null)', v_target)
          into v_target_deleted using p_member_id, p_owner_id;
      end if;
      execute format('update public.%I set %I=$1%s%s where id=$2 and workspace_owner_id = $3',
        v_target, v_column,
        case when v_target_deleted then ', deleted_at=null' else '' end,
        case when v_target_has_updated then ', updated_at=now()' else '' end)
        using p_attendance_status, p_member_id, p_owner_id;
      v_status := case when v_target_deleted then 'restored' else 'already_present_in_month' end;
    else
      -- The source and target month schemas differ across legitimate legacy
      -- tables.  Copy only their shared non-system columns, and keep owner and
      -- attendance values server-derived.
      execute format(
        'insert into public.%I (id, user_id, workspace_owner_id, %I)
         select $1, $2, $2, $3
         on conflict (id) do nothing', v_target, v_column
      ) using p_member_id, p_owner_id, p_attendance_status;
      -- Populate safe profile fields only when those columns exist on both sides.
      if public.month_table_has_column(v_source, 'Full Name') and public.month_table_has_column(v_target, 'Full Name') then
        execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Full Name') using v_source_member->>'Full Name', p_member_id, p_owner_id;
      end if;
      if public.month_table_has_column(v_source, 'Gender') and public.month_table_has_column(v_target, 'Gender') then
        execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Gender') using v_source_member->>'Gender', p_member_id, p_owner_id;
      end if;
      if public.month_table_has_column(v_source, 'Phone Number') and public.month_table_has_column(v_target, 'Phone Number') then
        execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Phone Number') using v_source_member->>'Phone Number', p_member_id, p_owner_id;
      end if;
      if public.month_table_has_column(v_source, 'Current Level') and public.month_table_has_column(v_target, 'Current Level') then
        execute format('update public.%I set %I = $1 where id=$2 and workspace_owner_id = $3', v_target, 'Current Level') using v_source_member->>'Current Level', p_member_id, p_owner_id;
      end if;
      v_status := 'imported_and_present';
    end if;
    v_assignment := public.ensure_workspace_member_code(p_owner_id, jsonb_build_object('id', p_member_id));
    execute format('select to_jsonb(t.*) from public.%I t where id=$1 and t.workspace_owner_id = $2', v_target)
      into v_existing using p_member_id, p_owner_id;
    v_response := jsonb_build_object('success', true, 'status', v_status, 'member_id', p_member_id,
      'member', v_existing, 'member_code', v_assignment.current_code, 'code_assignment', to_jsonb(v_assignment),
      'source_table', v_source, 'target_table', v_target, 'attendance_date', p_attendance_date,
      'attendance_status', p_attendance_status, 'request_id', p_request_id);
  exception when others then
    v_response := jsonb_build_object('success', false, 'status', 'error', 'error_message', sqlerrm, 'request_id', p_request_id);
  end;
  update public.member_mutation_idempotency
  set response = v_response, status = case when coalesce((v_response->>'success')::boolean, false) then 'success' else 'failed' end,
      error_message = case when coalesce((v_response->>'success')::boolean, false) then null else v_response->>'error_message' end,
      completed_at = now()
  where owner_id = p_owner_id and table_name = v_target and operation_name = 'set_member_attendance_from_other_month' and request_id = p_request_id;
  return v_response;
end;
$$;
revoke all on function public.set_member_attendance_from_other_month(uuid, date, date, uuid, date, text, text) from public, anon;
grant execute on function public.set_member_attendance_from_other_month(uuid, date, date, uuid, date, text, text) to authenticated;

create table if not exists public.paper_scan_save_operations (
  id uuid primary key,
  saved_scan_id uuid not null references public.paper_scan_saved(id) on delete restrict,
  owner_id uuid not null references auth.users(id),
  saved_scan_user_id uuid not null references auth.users(id),
  actor_id uuid not null references auth.users(id),
  immutable_plan jsonb not null,
  plan_hash text not null,
  status text not null default 'pending' check (status in ('pending','running','complete','failed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.paper_scan_save_operations add column if not exists saved_scan_user_id uuid references auth.users(id);
alter table public.paper_scan_save_operations alter column saved_scan_id set not null;
alter table public.paper_scan_save_operations alter column saved_scan_user_id set not null;
create table if not exists public.paper_scan_save_steps (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.paper_scan_save_operations(id) on delete cascade,
  step_key text not null, kind text not null check (kind in ('member-create','profile','attendance')),
  member_id uuid not null, month_start date not null, attendance_date date, attendance_status text,
  member_payload jsonb not null default '{}'::jsonb, profile_payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending' check (state in ('pending','running','succeeded','failed')),
  result jsonb, attempts integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(operation_id, step_key)
);
alter table public.paper_scan_save_operations enable row level security;
alter table public.paper_scan_save_steps enable row level security;
drop policy if exists "paper scan operation read" on public.paper_scan_save_operations;
create policy "paper scan operation private read" on public.paper_scan_save_operations for select to authenticated
  using (auth.uid() = saved_scan_user_id and public.has_permanent_workspace_access(owner_id));
drop policy if exists "paper scan step read" on public.paper_scan_save_steps;
create policy "paper scan step private read" on public.paper_scan_save_steps for select to authenticated
  using (exists (select 1 from public.paper_scan_save_operations o where o.id = operation_id
    and o.saved_scan_user_id = auth.uid() and public.has_permanent_workspace_access(o.owner_id)));
revoke all on public.paper_scan_save_operations, public.paper_scan_save_steps from public, anon, authenticated;
grant select on public.paper_scan_save_operations, public.paper_scan_save_steps to authenticated;

create or replace function public.require_private_saved_scan(p_saved_scan_id uuid, p_owner_id uuid)
returns public.paper_scan_saved
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid; v_scan public.paper_scan_saved%rowtype;
begin
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  select * into v_scan from public.paper_scan_saved
  where id = p_saved_scan_id and owner_id = p_owner_id and user_id = v_actor;
  if not found then
    raise exception 'Saved scan is not owned by this user in this workspace' using errcode = '42501';
  end if;
  return v_scan;
end;
$$;
revoke all on function public.require_private_saved_scan(uuid, uuid) from public, anon, authenticated;

create or replace function public.paper_scan_begin_save_operation(
  p_operation_id uuid, p_saved_scan_id uuid, p_owner_id uuid, p_plan jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_scan public.paper_scan_saved%rowtype;
  v_existing public.paper_scan_save_operations%rowtype;
  v_hash text;
  v_plan jsonb;
  v_row jsonb;
  v_item jsonb;
  v_index integer := 0;
  v_member_id uuid;
  v_month date;
  v_profile_month date;
  v_target_month date;
begin
  v_scan := public.require_private_saved_scan(p_saved_scan_id, p_owner_id);
  v_actor := auth.uid();
  if p_operation_id is null or jsonb_typeof(p_plan -> 'rows') <> 'array' then
    raise exception 'Invalid final-save plan' using errcode = '22023';
  end if;
  v_hash := md5(p_plan::text);
  select * into v_existing from public.paper_scan_save_operations where id = p_operation_id for update;
  if found then
    if v_existing.owner_id <> p_owner_id or v_existing.saved_scan_id <> p_saved_scan_id
       or v_existing.saved_scan_user_id <> v_actor or v_existing.plan_hash <> v_hash then
      raise exception 'Operation id is already bound to another private immutable plan' using errcode = '23505';
    end if;
    return jsonb_build_object('operation_id', v_existing.id, 'saved_scan_id', v_existing.saved_scan_id,
      'status', v_existing.status, 'immutable_plan', v_existing.immutable_plan,
      'steps', (select coalesce(jsonb_agg(to_jsonb(s) order by s.step_key), '[]'::jsonb)
        from public.paper_scan_save_steps s where s.operation_id = v_existing.id));
  end if;
  v_plan := p_plan;
  for v_row in select value from jsonb_array_elements(v_plan -> 'rows') loop
    v_index := v_index + 1;
    v_month := (v_row ->> 'month_start')::date;
    if v_month is null or v_month <> date_trunc('month', v_month)::date then
      raise exception 'Plan month must be a month start' using errcode = '22023';
    end if;
    perform public.ensure_workspace_month_registration(p_owner_id, v_month);
    if v_row ->> 'member_action' = 'create-new' then
      if jsonb_typeof(v_row -> 'target_months') <> 'array' or jsonb_array_length(v_row -> 'target_months') = 0 then
        raise exception 'Create-new rows require exact frozen target months' using errcode = '22023';
      end if;
      v_member_id := coalesce(nullif(v_row ->> 'member_id', '')::uuid, gen_random_uuid());
      v_plan := jsonb_set(v_plan, array['rows', (v_index - 1)::text, 'member_id'], to_jsonb(v_member_id), true);
      for v_item in select value from jsonb_array_elements(v_row -> 'target_months') loop
        v_target_month := (v_item #>> '{}')::date;
        if v_target_month is null or v_target_month <> date_trunc('month', v_target_month)::date then
          raise exception 'Frozen target month is invalid' using errcode = '22023';
        end if;
        perform public.ensure_workspace_month_registration(p_owner_id, v_target_month);
      end loop;
    elsif nullif(v_row ->> 'member_id', '') is null then
      raise exception 'Existing-member rows require a canonical member id' using errcode = '22023';
    end if;
  end loop;
  insert into public.paper_scan_save_operations(id, saved_scan_id, owner_id, saved_scan_user_id, actor_id, immutable_plan, plan_hash)
  values (p_operation_id, p_saved_scan_id, p_owner_id, v_scan.user_id, v_actor, v_plan, v_hash);
  v_index := 0;
  for v_row in select value from jsonb_array_elements(v_plan -> 'rows') loop
    v_index := v_index + 1;
    v_month := (v_row ->> 'month_start')::date;
    v_member_id := (v_row ->> 'member_id')::uuid;
    if v_row ->> 'member_action' = 'create-new' then
      -- Do not query the mutable registry here.  The persisted array is the sole
      -- authority for all-year creates and every retry.
      for v_item in select value from jsonb_array_elements(v_row -> 'target_months') loop
        v_target_month := (v_item #>> '{}')::date;
        insert into public.paper_scan_save_steps(operation_id, step_key, kind, member_id, month_start, member_payload)
        values (p_operation_id, v_index || ':member:' || v_target_month::text, 'member-create', v_member_id,
          v_target_month, coalesce(v_row -> 'member_payload', '{}'::jsonb));
      end loop;
    elsif jsonb_typeof(v_row -> 'profile_updates') = 'object' and v_row -> 'profile_updates' <> '{}'::jsonb then
      v_profile_month := coalesce((v_row ->> 'profile_month_start')::date, v_month);
      perform public.ensure_workspace_month_registration(p_owner_id, v_profile_month);
      insert into public.paper_scan_save_steps(operation_id, step_key, kind, member_id, month_start, profile_payload)
      values (p_operation_id, v_index || ':profile', 'profile', v_member_id, v_profile_month, v_row -> 'profile_updates');
    end if;
    for v_item in select value from jsonb_array_elements(coalesce(v_row -> 'attendance', '[]'::jsonb)) loop
      v_target_month := date_trunc('month', (v_item ->> 'date')::date)::date;
      perform public.ensure_workspace_month_registration(p_owner_id, v_target_month);
      insert into public.paper_scan_save_steps(operation_id, step_key, kind, member_id, month_start, attendance_date, attendance_status)
      values (p_operation_id, v_index || ':attendance:' || (v_item ->> 'date'), 'attendance', v_member_id,
        v_target_month, (v_item ->> 'date')::date, v_item ->> 'status');
    end loop;
  end loop;
  return jsonb_build_object('operation_id', p_operation_id, 'saved_scan_id', p_saved_scan_id, 'status', 'pending',
    'immutable_plan', v_plan, 'steps', (select coalesce(jsonb_agg(to_jsonb(s) order by s.step_key), '[]'::jsonb)
      from public.paper_scan_save_steps s where s.operation_id = p_operation_id));
end;
$$;
revoke all on function public.paper_scan_begin_save_operation(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.paper_scan_begin_save_operation(uuid, uuid, uuid, jsonb) to authenticated;

create or replace function public.paper_scan_get_save_operation(
  p_owner_id uuid, p_saved_scan_id uuid, p_operation_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_scan public.paper_scan_saved%rowtype; v_operation public.paper_scan_save_operations%rowtype;
begin
  v_scan := public.require_private_saved_scan(p_saved_scan_id, p_owner_id);
  select * into v_operation from public.paper_scan_save_operations
  where owner_id = p_owner_id and saved_scan_id = v_scan.id and saved_scan_user_id = v_scan.user_id
    and (p_operation_id is null or id = p_operation_id)
  order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('operation_id', v_operation.id, 'saved_scan_id', v_operation.saved_scan_id,
    'status', v_operation.status, 'immutable_plan', v_operation.immutable_plan,
    'steps', (select coalesce(jsonb_agg(to_jsonb(s) order by s.step_key), '[]'::jsonb)
      from public.paper_scan_save_steps s where s.operation_id = v_operation.id));
end;
$$;
revoke all on function public.paper_scan_get_save_operation(uuid, uuid, uuid) from public, anon;
grant execute on function public.paper_scan_get_save_operation(uuid, uuid, uuid) to authenticated;

create or replace function public.paper_scan_execute_save_step(p_operation_id uuid, p_step_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  o public.paper_scan_save_operations%rowtype;
  s public.paper_scan_save_steps%rowtype;
  v_table text;
  v_column text;
  v_sql text;
  v_count integer := 0;
  v_has_deleted boolean;
  v_authorized boolean := false;
begin
  -- These checks are intentionally outside the exception block.  An unknown,
  -- anonymous, inactive, cross-workspace, or foreign-plan caller cannot reach
  -- either the step or operation failure updates below.
  v_actor := auth.uid();
  if v_actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A permanent authenticated user is required' using errcode = '42501';
  end if;
  select * into o from public.paper_scan_save_operations where id = p_operation_id for update;
  if not found then raise exception 'Unknown save operation' using errcode = '42501'; end if;
  perform public.require_permanent_workspace_actor(o.owner_id, false);
  if o.saved_scan_user_id <> v_actor then
    raise exception 'Final Save operation plan is private to its Saved Scan owner' using errcode = '42501';
  end if;
  if not exists (select 1 from public.paper_scan_saved ps where ps.id = o.saved_scan_id
    and ps.owner_id = o.owner_id and ps.user_id = o.saved_scan_user_id) then
    raise exception 'Saved Scan ownership no longer matches this operation' using errcode = '42501';
  end if;
  select * into s from public.paper_scan_save_steps where id = p_step_id and operation_id = o.id for update;
  if not found then raise exception 'Unknown save step' using errcode = '42501'; end if;
  v_authorized := true;
  if s.state = 'succeeded' then
    return coalesce(s.result, jsonb_build_object('success', true, 'step_id', s.id));
  end if;
  begin
    update public.paper_scan_save_steps set state = 'running', attempts = attempts + 1, updated_at = now() where id = s.id;
    v_table := public.workspace_month_table_for(o.owner_id, s.month_start);
    v_has_deleted := public.month_table_has_column(v_table, 'deleted_at');
    if s.kind = 'member-create' then
      perform pg_advisory_xact_lock(hashtextextended(s.member_id::text, 0));
      if coalesce(nullif(btrim(s.member_payload ->> 'Full Name'), ''), nullif(btrim(s.member_payload ->> 'full_name'), '')) is null then
        raise exception 'An approved name is required';
      end if;
      if exists (
        select 1 from public.workspace_member_provenance_exclusions where member_id = s.member_id
      ) then
        raise exception 'Member id % is excluded from workspace provenance', s.member_id;
      end if;
      if exists (
        select 1 from public.workspace_member_codes where member_id = s.member_id and workspace_owner_id <> o.owner_id
      ) then
        raise exception 'Member id % belongs to another workspace', s.member_id;
      end if;
      v_sql := format('insert into public.%I (id, user_id, workspace_owner_id, %I, %I, %I, %I) values ($1,$2,$2,$3,$4,$5,$6) on conflict (id) do nothing',
        v_table, 'Full Name', 'Gender', 'Phone Number', 'Current Level');
      execute v_sql using s.member_id, o.owner_id, coalesce(s.member_payload ->> 'Full Name', s.member_payload ->> 'full_name'),
        coalesce(s.member_payload ->> 'Gender', s.member_payload ->> 'gender'),
        coalesce(s.member_payload ->> 'Phone Number', s.member_payload ->> 'phone_number'),
        coalesce(s.member_payload ->> 'Current Level', s.member_payload ->> 'current_level');
      get diagnostics v_count = row_count;
      if v_count = 0 then
        declare
          v_existing_owner uuid;
          v_existing_deleted boolean := false;
        begin
          execute format(
            'select workspace_owner_id%s from public.%I where id = $1',
            case when v_has_deleted then ', deleted_at is not null' else '' end,
            v_table
          ) into v_existing_owner, v_existing_deleted using s.member_id;

          if v_existing_owner is null or v_existing_owner <> o.owner_id or coalesce(v_existing_deleted, false) then
            raise exception 'Member id % is not owned by the authorized workspace', s.member_id;
          end if;
        end;
      end if;
      perform public.ensure_workspace_member_code(o.owner_id, jsonb_build_object('id', s.member_id));
    elsif s.kind = 'profile' then
      if jsonb_typeof(s.profile_payload) <> 'object' or s.profile_payload = '{}'::jsonb then raise exception 'No approved profile fields'; end if;
      v_sql := format('update public.%I set ', v_table);
      if s.profile_payload ? 'full_name' or s.profile_payload ? 'Full Name' then
        v_sql := v_sql || format('%I = $1, ', 'Full Name');
      else
        v_sql := v_sql || format('%I = %I, ', 'Full Name', 'Full Name');
      end if;
      if s.profile_payload ? 'phone_number' or s.profile_payload ? 'Phone Number' then
        v_sql := v_sql || format('%I = $2, ', 'Phone Number');
      else
        v_sql := v_sql || format('%I = %I, ', 'Phone Number', 'Phone Number');
      end if;
      if s.profile_payload ? 'gender' or s.profile_payload ? 'Gender' then
        v_sql := v_sql || format('%I = $3, ', 'Gender');
      else
        v_sql := v_sql || format('%I = %I, ', 'Gender', 'Gender');
      end if;
      if s.profile_payload ? 'current_level' or s.profile_payload ? 'Current Level' then
        v_sql := v_sql || format('%I = $4, ', 'Current Level');
      else
        v_sql := v_sql || format('%I = %I, ', 'Current Level', 'Current Level');
      end if;
      v_sql := regexp_replace(v_sql, ', $', '') || format(' where id=$5 and workspace_owner_id = $6%s', case when v_has_deleted then ' and deleted_at is null' else '' end);
      execute v_sql using
        coalesce(s.profile_payload ->> 'Full Name', s.profile_payload ->> 'full_name'),
        coalesce(s.profile_payload ->> 'Phone Number', s.profile_payload ->> 'phone_number'),
        coalesce(s.profile_payload ->> 'Gender', s.profile_payload ->> 'gender'),
        coalesce(s.profile_payload ->> 'Current Level', s.profile_payload ->> 'current_level'),
        s.member_id, o.owner_id;
      get diagnostics v_count = row_count;
      if v_count <> 1 then raise exception 'Member is not present in the trusted month'; end if;
    else
      if s.attendance_date is null or extract(isodow from s.attendance_date) <> 7 or s.attendance_status not in ('Present', 'Absent') then
        raise exception 'Invalid attendance step';
      end if;
      v_column := public.ensure_workspace_attendance_column(o.owner_id, s.month_start, s.attendance_date);
      execute format('update public.%I set %I=$1 where id=$2 and workspace_owner_id = $3%s', v_table, v_column,
        case when v_has_deleted then ' and deleted_at is null' else '' end) using s.attendance_status, s.member_id, o.owner_id;
      get diagnostics v_count = row_count;
      if v_count <> 1 then raise exception 'Member is not present in the trusted month'; end if;
    end if;
    update public.paper_scan_save_steps set state = 'succeeded', result = jsonb_build_object('success', true, 'step_id', s.id, 'affected', v_count), updated_at = now() where id = s.id;
    update public.paper_scan_save_operations set status = case when not exists(
      select 1 from public.paper_scan_save_steps where operation_id = o.id and state <> 'succeeded'
    ) then 'complete' else 'running' end, updated_at = now() where id = o.id;
    return jsonb_build_object('success', true, 'step_id', s.id, 'affected', v_count);
  exception when others then
    -- v_authorized becomes true only after actor, workspace, saved-scan owner,
    -- operation, and step have all been proven together.
    if v_authorized then
      update public.paper_scan_save_steps set state = 'failed', result = jsonb_build_object('success', false, 'error', sqlerrm), updated_at = now()
      where id = s.id and operation_id = o.id;
      update public.paper_scan_save_operations set status = 'failed', updated_at = now() where id = o.id;
    end if;
    return jsonb_build_object('success', false, 'step_id', p_step_id, 'error_message', sqlerrm);
  end;
end;
$$;
revoke all on function public.paper_scan_execute_save_step(uuid, uuid) from public, anon;
grant execute on function public.paper_scan_execute_save_step(uuid, uuid) to authenticated;

-- Legacy member writes and direct month-table RLS share the same boundary as
-- Final Save.  A row's author/user_id is retained for compatibility only; it
-- is never workspace provenance.  Browser clients may read/write only rows
-- whose immutable workspace_owner_id belongs to a workspace for which the
-- current permanent actor is an owner or accepted/active collaborator.
create or replace function public.is_permanent_workspace_actor(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and (auth.uid() = p_owner_id or exists (
      select 1 from public.collaborators c
      where c.owner_id = p_owner_id
        and c.status in ('accepted', 'active')
        and (c.collaborator_user_id = auth.uid()
          or lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    ));
$$;
revoke all on function public.is_permanent_workspace_actor(uuid) from public, anon;
grant execute on function public.is_permanent_workspace_actor(uuid) to authenticated;

create or replace function public.harden_month_workspace_rls(p_table_name text)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare r record;
begin
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'
     or to_regclass(format('public.%I', p_table_name)) is null
     or not public.month_table_has_column(p_table_name, 'workspace_owner_id') then
    raise exception 'Invalid trusted month table' using errcode = '22023';
  end if;
  execute format('alter table public.%I enable row level security', p_table_name);
  for r in select policyname from pg_policies
    where schemaname = 'public' and tablename = p_table_name
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, p_table_name);
  end loop;
  execute format(
    'create policy %I on public.%I for select to authenticated
       using (public.is_permanent_workspace_actor(workspace_owner_id))',
    p_table_name || '_workspace_read', p_table_name);
  execute format(
    'create policy %I on public.%I for insert to authenticated
       with check (public.is_permanent_workspace_actor(workspace_owner_id))',
    p_table_name || '_workspace_insert', p_table_name);
  execute format(
    'create policy %I on public.%I for update to authenticated
       using (public.is_permanent_workspace_actor(workspace_owner_id))
       with check (public.is_permanent_workspace_actor(workspace_owner_id))',
    p_table_name || '_workspace_update', p_table_name);
  execute format(
    'create policy %I on public.%I for delete to authenticated
       using (public.is_permanent_workspace_actor(workspace_owner_id))',
    p_table_name || '_workspace_delete', p_table_name);
end;
$$;
revoke all on function public.harden_month_workspace_rls(text) from public, anon, authenticated;

-- Reconcile and RLS-harden every legitimate canonical month relation.  The
-- reconciliation leaves ambiguous rows unowned, so the policies deny them.
do $$
declare r record;
begin
  for r in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
  loop
    perform public.harden_month_workspace_provenance(r.table_name);
    perform public.lock_month_workspace_provenance(r.table_name);
    perform public.harden_month_workspace_rls(r.table_name);
  end loop;
end;
$$;

-- Central trusted target resolver.  The compatibility signature still takes
-- p_table_name, but it is accepted only when it equals the server-owned
-- workspace_month_tables mapping for the requested workspace and logical
-- month.  No recovery by name/phone or row.user_id is permitted: UUID is the
-- canonical identity and an absent/ambiguous row fails closed.
create or replace function public.resolve_member_update_target(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_identity jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_month_start date; v_table text; v_has_deleted boolean; v_found integer;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_member_id is null or p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$' then
    raise exception 'A canonical member id and logical month are required' using errcode = '22023';
  end if;
  v_month_start := to_date(replace(p_table_name, '_', ' ') || ' 01', 'FMMonth YYYY DD');
  if to_char(v_month_start, 'FMMonth_YYYY') <> p_table_name then
    raise exception 'Invalid logical month' using errcode = '22023';
  end if;
  v_table := public.workspace_month_table_for(p_owner_id, v_month_start);
  if v_table <> p_table_name then
    raise exception 'Caller month does not match the trusted workspace mapping' using errcode = '42501';
  end if;
  v_has_deleted := public.month_table_has_column(v_table, 'deleted_at');
  execute format('select count(*) from public.%I where id = $1 and workspace_owner_id = $2%s',
    v_table, case when v_has_deleted then ' and deleted_at is null' else '' end)
    into v_found using p_member_id, p_owner_id;
  if v_found <> 1 then
    raise exception 'Member is not an active member of the trusted workspace month' using errcode = '42501';
  end if;
  return jsonb_build_object('member_id', p_member_id, 'table_name', v_table, 'month_start', v_month_start, 'recovered', false);
end;
$$;

create or replace function public.trusted_workspace_month_from_compat_name(
  p_owner_id uuid, p_table_name text
) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_month_start date; v_table text;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$' then
    raise exception 'A canonical logical month is required' using errcode = '22023';
  end if;
  v_month_start := to_date(replace(p_table_name, '_', ' ') || ' 01', 'FMMonth YYYY DD');
  if to_char(v_month_start, 'FMMonth_YYYY') <> p_table_name then
    raise exception 'Invalid logical month' using errcode = '22023';
  end if;
  v_table := public.workspace_month_table_for(p_owner_id, v_month_start);
  if v_table <> p_table_name then
    raise exception 'Caller month does not match the trusted workspace mapping' using errcode = '42501';
  end if;
  return v_table;
end;
$$;
revoke all on function public.trusted_workspace_month_from_compat_name(uuid, text) from public, anon, authenticated;

create or replace function public.update_member_record(
  p_table_name text, p_member_id uuid, p_updates jsonb, p_owner_id uuid
) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_target jsonb; v_table text; v_key text; v_val jsonb; v_set text := ''; v_count integer;
begin
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, '{}'::jsonb);
  v_table := v_target ->> 'table_name';
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'Updates must be a JSON object' using errcode = '22023';
  end if;
  for v_key, v_val in select key, value from jsonb_each(p_updates) loop
    if v_key not in ('Full Name','Phone Number','Gender','Age','Current Level','date_of_birth',
      'parent_name_1','parent_phone_1','parent_name_2','parent_phone_2','notes','ministry','is_visitor',
      'Member','Regular','Newcomer','Manual Badge','Badge Type','updated_at')
       or not public.month_table_has_column(v_table, v_key) then
      raise exception 'Unsupported member field' using errcode = '22023';
    end if;
    v_set := v_set || case when v_set = '' then '' else ', ' end ||
      case when v_val is null or v_val = 'null'::jsonb then format('%I = null', v_key)
           else format('%I = %L', v_key, v_val #>> '{}') end;
  end loop;
  if v_set = '' then raise exception 'No permitted member fields supplied' using errcode = '22023'; end if;
  execute format('update public.%I set %s where id = $1 and workspace_owner_id = $2', v_table, v_set)
    using p_member_id, p_owner_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Trusted member update affected % rows', v_count using errcode = '42501'; end if;
end;
$$;

create or replace function public.update_member_record_resilient(
  p_table_name text, p_member_id uuid, p_updates jsonb, p_owner_id uuid,
  p_identity jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_target jsonb; v_table text; v_row jsonb; v_has_deleted boolean;
begin
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, p_identity);
  v_table := v_target ->> 'table_name';
  perform public.update_member_record(v_table, p_member_id, p_updates, p_owner_id);
  v_has_deleted := public.month_table_has_column(v_table, 'deleted_at');
  execute format('select to_jsonb(t.*) from public.%I t where t.id=$1 and t.workspace_owner_id=$2%s',
    v_table, case when v_has_deleted then ' and t.deleted_at is null' else '' end)
    into v_row using p_member_id, p_owner_id;
  if v_row is null then raise exception 'Member verification failed after trusted update' using errcode = '42501'; end if;
  return jsonb_build_object('success', true, 'member_id', p_member_id, 'table_name', v_table, 'recovered', false, 'row', v_row);
end;
$$;

create or replace function public.soft_delete_member(
  p_table_name text, p_member_id uuid, p_owner_id uuid
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_target jsonb; v_table text; v_count integer; v_has_updated boolean;
begin
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, '{}'::jsonb);
  v_table := v_target ->> 'table_name';
  if not public.month_table_has_column(v_table, 'deleted_at') then
    raise exception 'Trusted month does not support soft deletion' using errcode = '22023';
  end if;
  v_has_updated := public.month_table_has_column(v_table, 'updated_at');
  execute format('update public.%I set deleted_at=now()%s where id=$1 and workspace_owner_id=$2 and deleted_at is null',
    v_table, case when v_has_updated then ', updated_at=now()' else '' end) using p_member_id, p_owner_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Trusted soft delete affected % rows', v_count using errcode = '42501'; end if;
  return true;
end;
$$;

-- The historical bundle function mutates by raw table/id, including tags and
-- attendance columns.  Keep only its hardened wrapper public; the wrapper
-- resolves provenance first and then invokes the private implementation.
create or replace function public.update_member_bundle_resilient(
  p_table_name text, p_owner_id uuid, p_member_id uuid, p_request_id text,
  p_updates jsonb default '{}'::jsonb, p_badges text[] default null,
  p_tag_ids uuid[] default null, p_attendance jsonb default '{}'::jsonb,
  p_identity jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_target jsonb; v_table text; v_result jsonb; v_has_deleted boolean; v_verified boolean;
begin
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, p_identity);
  v_table := v_target ->> 'table_name';
  -- update_member_bundle is redefined below with the same trusted predicate.
  v_result := public.update_member_bundle(v_table, p_owner_id, p_member_id, p_request_id, p_updates, p_badges, p_tag_ids, p_attendance);
  v_has_deleted := public.month_table_has_column(v_table, 'deleted_at');
  execute format('select exists(select 1 from public.%I where id=$1 and workspace_owner_id=$2%s)',
    v_table, case when v_has_deleted then ' and deleted_at is null' else '' end)
    into v_verified using p_member_id, p_owner_id;
  if not coalesce((v_result ->> 'success')::boolean, false) or not v_verified then
    raise exception '%', coalesce(v_result ->> 'error_message', 'Trusted member bundle verification failed');
  end if;
  return v_result || jsonb_build_object('member_id', p_member_id, 'table_name', v_table, 'recovered', false, 'verified', true);
end;
$$;

-- New-member compatibility wrapper.  It has the old UI payload shape but
-- derives the physical relation itself and overwrites actor-controlled owner
-- fields before the retained private bundle implementation can see them.
create or replace function public.save_member_bundle_resilient(
  p_table_name text, p_owner_id uuid, p_request_id text, p_member jsonb,
  p_badges text[] default '{}'::text[], p_tag_ids uuid[] default '{}'::uuid[],
  p_attendance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_table text; v_member jsonb; v_result jsonb; v_member_id uuid; v_has_deleted boolean; v_verified boolean;
begin
  v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, p_table_name);
  if p_member is null or jsonb_typeof(p_member) <> 'object' then
    raise exception 'Member payload must be a JSON object' using errcode = '22023';
  end if;
  v_member := (p_member - 'workspace_owner_id' - 'user_id') || jsonb_build_object(
    'workspace_owner_id', p_owner_id, 'user_id', p_owner_id
  );
  v_result := public.save_member_bundle(v_table, p_owner_id, p_request_id, v_member, p_badges, p_tag_ids, p_attendance);
  v_member_id := nullif(v_result ->> 'member_id', '')::uuid;
  v_has_deleted := public.month_table_has_column(v_table, 'deleted_at');
  if v_member_id is not null then
    execute format('select exists(select 1 from public.%I where id=$1 and workspace_owner_id=$2%s)',
      v_table, case when v_has_deleted then ' and deleted_at is null' else '' end)
      into v_verified using v_member_id, p_owner_id;
  end if;
  if not coalesce((v_result ->> 'success')::boolean, false) or not coalesce(v_verified, false) then
    raise exception '%', coalesce(v_result ->> 'error_message', 'Trusted member creation verification failed');
  end if;
  perform public.ensure_workspace_member_code(p_owner_id, jsonb_build_object('id', v_member_id));
  return v_result || jsonb_build_object('member_id', v_member_id, 'table_name', v_table, 'verified', true);
end;
$$;

create or replace function public.assign_tag_to_member(
  p_tag_id uuid, p_member_id uuid, p_table_name text, p_owner_id uuid
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_target jsonb; v_table text;
begin
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, '{}'::jsonb);
  v_table := v_target ->> 'table_name';
  if not exists (select 1 from public.tags where id = p_tag_id and owner_id = p_owner_id) then
    raise exception 'Tag not found or access denied' using errcode = '42501';
  end if;
  insert into public.member_tags(tag_id, member_id, table_name)
  values (p_tag_id, p_member_id, v_table) on conflict (tag_id, member_id, table_name) do nothing;
  return true;
end;
$$;

create or replace function public.remove_tag_from_member(
  p_tag_id uuid, p_member_id uuid, p_table_name text, p_owner_id uuid
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_target jsonb; v_table text;
begin
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, '{}'::jsonb);
  v_table := v_target ->> 'table_name';
  if not exists (select 1 from public.tags where id = p_tag_id and owner_id = p_owner_id) then
    raise exception 'Tag not found or access denied' using errcode = '42501';
  end if;
  delete from public.member_tags where tag_id=p_tag_id and member_id=p_member_id and table_name=v_table;
  return true;
end;
$$;

-- Remove public execution from every obsolete raw-table member mutation.  The
-- app paths use the logical/provenance-aware wrappers above after this migration.
revoke all on function public.resolve_member_update_target(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.update_member_record(text, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.update_member_record_resilient(text, uuid, jsonb, uuid, jsonb) from public, anon;
revoke all on function public.update_member_bundle(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.update_member_bundle_resilient(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb, jsonb) from public, anon;
revoke all on function public.soft_delete_member(text, uuid) from public, anon, authenticated;
revoke all on function public.delete_member_by_id(text, uuid) from public, anon, authenticated;
revoke all on function public.set_month_owner_user(text, uuid) from public, anon, authenticated;
revoke all on function public.save_member_bundle(text, uuid, text, jsonb, text[], uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.update_member_profile_all_months(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.assign_tag_to_member(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.remove_tag_from_member(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.update_member_record(text, uuid, jsonb, uuid) to authenticated;
grant execute on function public.update_member_record_resilient(text, uuid, jsonb, uuid, jsonb) to authenticated;
grant execute on function public.update_member_bundle_resilient(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb, jsonb) to authenticated;
grant execute on function public.soft_delete_member(text, uuid, uuid) to authenticated;
grant execute on function public.save_member_bundle_resilient(text, uuid, text, jsonb, text[], uuid[], jsonb) to authenticated;
grant execute on function public.assign_tag_to_member(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.remove_tag_from_member(uuid, uuid, text, uuid) to authenticated;

-- Helper to verify that a canonical member actually belongs to the authorized workspace
-- through an existing code claim, an operator provenance override, or presence in a registered month table.
create or replace function public.member_belongs_to_workspace(p_owner_id uuid, p_member_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  v_found boolean := false;
begin
  if p_owner_id is null or p_member_id is null then
    return false;
  end if;

  -- 1. Check existing workspace_member_codes claim
  if exists (
    select 1 from public.workspace_member_codes
    where workspace_owner_id = p_owner_id and member_id = p_member_id
  ) then
    return true;
  end if;

  -- 2. Check provenance overrides
  if exists (
    select 1 from public.workspace_member_provenance_overrides
    where workspace_owner_id = p_owner_id and member_id = p_member_id
      and not exists (
        select 1 from public.workspace_member_provenance_exclusions ex
        where ex.member_id = p_member_id
      )
  ) then
    return true;
  end if;

  -- 3. Check registered workspace month tables
  for r in
    select table_name
    from public.workspace_month_tables
    where owner_id = p_owner_id
  loop
    if to_regclass(format('public.%I', r.table_name)) is not null
       and public.month_table_has_column(r.table_name, 'workspace_owner_id') then
      execute format(
        'select exists(select 1 from public.%I where id = $1 and workspace_owner_id = $2%s)',
        r.table_name,
        case when public.month_table_has_column(r.table_name, 'deleted_at') then ' and deleted_at is null' else '' end
      ) into v_found using p_member_id, p_owner_id;

      if v_found then
        return true;
      end if;
    end if;
  end loop;

  return false;
end;
$$;
revoke all on function public.member_belongs_to_workspace(uuid, uuid) from public, anon, authenticated;

-- Hardened member-code batch allocator with member-scoped advisory locks,
-- provenance exclusion defense, and mandatory server-side workspace ownership verification.
create or replace function public.ensure_workspace_member_codes(p_owner_id uuid, p_members jsonb)
returns setof public.workspace_member_codes
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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
  v_lock_id uuid;
  v_effective_legacy text;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);

  if jsonb_typeof(p_members) <> 'array' or coalesce(p_members, '[]'::jsonb) = '[]'::jsonb then
    return;
  end if;

  select
    coalesce(member_code_format, 'alphanumeric'),
    coalesce(member_code_length, 3)::smallint
  into v_format, v_length
  from public.user_preferences
  where user_id = p_owner_id;

  v_format := coalesce(v_format, 'alphanumeric');
  v_length := coalesce(v_length, 3::smallint);

  -- Phase 1: Acquire member-scoped advisory locks in deterministic UUID order for all distinct requested members
  for v_lock_id in
    select distinct nullif(value ->> 'id', '')::uuid as member_id
    from jsonb_array_elements(p_members)
    where nullif(value ->> 'id', '') is not null
    order by member_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 0));
  end loop;

  -- Phase 2: Acquire the workspace sequential code allocator lock ONCE per batch AFTER all member locks are held
  perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));

  -- Phase 3: Perform server-proven validation and sequential allocation for each distinct member
  for v_member in
    select distinct on (member_id)
      member_id,
      legacy_code
    from (
      select
        nullif(value ->> 'id', '')::uuid as member_id,
        upper(regexp_replace(coalesce(value ->> 'legacy_code', ''), '[^A-Za-z0-9]', '', 'g')) as legacy_code
      from jsonb_array_elements(p_members)
    ) incoming
    where member_id is not null
    order by member_id, legacy_code
  loop
    -- Defensive exclusion check
    if exists (
      select 1 from public.workspace_member_provenance_exclusions where member_id = v_member.member_id
    ) then
      raise exception 'Member id % is excluded from workspace provenance', v_member.member_id using errcode = '42501';
    end if;

    -- Defensive foreign workspace claim check
    if exists (
      select 1 from public.workspace_member_codes
      where member_id = v_member.member_id and workspace_owner_id <> p_owner_id
    ) then
      raise exception 'Member id % belongs to another workspace', v_member.member_id using errcode = '42501';
    end if;

    -- Idempotent check: if already allocated under this workspace, preserve it
    if exists (
      select 1
      from public.workspace_member_codes existing
      where existing.workspace_owner_id = p_owner_id
        and existing.member_id = v_member.member_id
    ) then
      continue;
    end if;

    -- Server-side proof that member belongs to authorized workspace
    if not public.member_belongs_to_workspace(p_owner_id, v_member.member_id) then
      raise exception 'Member id % does not belong to authorized workspace %', v_member.member_id, p_owner_id using errcode = '42501';
    end if;

    select coalesce(max(ordinal), 0)
    into v_next_ordinal
    from public.workspace_member_codes
    where workspace_owner_id = p_owner_id;

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

    v_effective_legacy := coalesce(nullif(btrim(coalesce(v_member.legacy_code, '')), ''), v_candidate);

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
      v_effective_legacy,
      v_candidate,
      case
        when nullif(btrim(coalesce(v_member.legacy_code, '')), '') is not null
          and upper(v_member.legacy_code) <> upper(v_candidate)
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
      from jsonb_array_elements(p_members)
      where nullif(value ->> 'id', '') is not null
    )
  order by assignment.ordinal;
end;
$$;
revoke all on function public.ensure_workspace_member_codes(uuid, jsonb) from public, anon;
grant execute on function public.ensure_workspace_member_codes(uuid, jsonb) to authenticated;

-- Single-member allocator wrapper delegating to ensure_workspace_member_codes
create or replace function public.ensure_workspace_member_code(
  p_owner_id uuid,
  p_member jsonb
)
returns public.workspace_member_codes
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_member_id uuid := nullif(p_member ->> 'id', '')::uuid;
  v_assignment public.workspace_member_codes%rowtype;
begin
  if v_member_id is null then
    raise exception 'A canonical member id is required for member-code allocation' using errcode = '22023';
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
    raise exception 'Member-code allocation completed without an assignment' using errcode = 'P0001';
  end if;

  return v_assignment;
end;
$$;
revoke all on function public.ensure_workspace_member_code(uuid, jsonb) from public, anon;
grant execute on function public.ensure_workspace_member_code(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
;
