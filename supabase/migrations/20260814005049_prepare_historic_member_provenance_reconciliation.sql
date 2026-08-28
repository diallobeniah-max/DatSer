-- Operator-verified historic member workspace provenance.  This migration is
-- intentionally separate from the RLS cutover: it creates no month-table
-- provenance, changes no member content, and may be applied before review.
create table if not exists public.workspace_member_provenance_overrides (
  member_id uuid primary key,
  workspace_owner_id uuid not null references auth.users(id),
  resolution_source text not null default 'operator_verified'
    check (resolution_source = 'operator_verified'),
  resolved_by uuid not null references auth.users(id),
  resolved_at timestamptz not null default now(),
  reconciliation_version integer not null default 1 check (reconciliation_version > 0),
  reconciliation_note text null check (char_length(coalesce(reconciliation_note, '')) <= 1000)
);
alter table public.workspace_member_provenance_overrides enable row level security;
revoke all on table public.workspace_member_provenance_overrides from public, anon, authenticated;

-- This deliberately uses app_metadata, not user_metadata.  The claim must be
-- provisioned by a service/admin process; workspace collaborators are never
-- provenance operators merely because they can edit a workspace.
create or replace function public.require_historic_provenance_operator()
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or coalesce(auth.jwt() -> 'app_metadata' ->> 'datser_provenance_operator', 'false') <> 'true' then
    raise exception 'Historic provenance operator authorization required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function public.require_historic_provenance_operator() from public, anon, authenticated;

-- Operator-only occurrence feed.  The client groups occurrences by member_id,
-- so January through August copies are reviewed once, not eight times.
create or replace function public.get_historic_member_provenance_review()
returns table(member_id uuid, source_month text, display_name text, phone_hint text,
  member_code text, gender text, current_level text, reason text, candidate_workspace_ids uuid[])
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare r record;
begin
  perform public.require_historic_provenance_operator();
  for r in select c.relname as table_name
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
  loop
    return query execute format(
      'select s.id, %L::text, s."Full Name",
         case when length(regexp_replace(coalesce(s."Phone Number", ''''), ''[^0-9]'', '''', ''g'')) >= 4
           then ''***'' || right(regexp_replace(s."Phone Number", ''[^0-9]'', '''', ''g''), 4) else null end,
         c.member_code, s."Gender", s."Current Level",
         case when coalesce(c.owner_count, 0) = 0 then ''UNMAPPED'' else ''AMBIGUOUS'' end,
         coalesce(c.owner_ids, array[]::uuid[])
       from public.%I s
       left join lateral (
         select count(distinct w.workspace_owner_id) as owner_count,
                array_agg(distinct w.workspace_owner_id) as owner_ids,
                min(w.current_code) as member_code
         from public.workspace_member_codes w where w.member_id = s.id
       ) c on true
       left join public.workspace_member_provenance_overrides o on o.member_id = s.id
       where o.member_id is null and coalesce(c.owner_count, 0) <> 1',
      r.table_name, r.table_name
    );
  end loop;
end;
$$;
revoke all on function public.get_historic_member_provenance_review() from public, anon;
grant execute on function public.get_historic_member_provenance_review() to authenticated;

create or replace function public.record_workspace_member_provenance_override(
  p_member_id uuid,
  p_workspace_owner_id uuid,
  p_note text default null,
  p_reconciliation_version integer default 1
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid; v_existing uuid; v_result jsonb; v_candidate_count integer;
begin
  v_actor := public.require_historic_provenance_operator();
  if p_member_id is null or p_workspace_owner_id is null then
    raise exception 'Member and workspace owner are required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_workspace_owner_id) then
    raise exception 'Verified workspace owner does not exist' using errcode = '22023';
  end if;
  select count(distinct workspace_owner_id)
  into v_candidate_count
  from public.workspace_member_codes where member_id = p_member_id;
  if v_candidate_count = 1 then
    raise exception 'Deterministic workspace-code provenance already owns this canonical member' using errcode = '23505';
  end if;
  if v_candidate_count > 1 then
    raise exception 'Canonical member has multiple trusted workspace owners; identity repair is required before provenance assignment' using errcode = '23505';
  end if;
  insert into public.workspace_member_provenance_overrides
    (member_id, workspace_owner_id, resolved_by, reconciliation_note, reconciliation_version)
  values (p_member_id, p_workspace_owner_id, v_actor, p_note, coalesce(p_reconciliation_version, 1))
  on conflict (member_id) do nothing
  returning jsonb_build_object('member_id', member_id, 'workspace_owner_id', workspace_owner_id,
    'resolved_by', resolved_by, 'resolved_at', resolved_at) into v_result;
  if v_result is null then
    select workspace_owner_id into v_existing
    from public.workspace_member_provenance_overrides where member_id = p_member_id;
    if v_existing <> p_workspace_owner_id then
      raise exception 'Canonical member already has a different verified workspace; resolve identity conflict separately' using errcode = '23505';
    end if;
    select jsonb_build_object('member_id', member_id, 'workspace_owner_id', workspace_owner_id,
      'resolved_by', resolved_by, 'resolved_at', resolved_at)
    into v_result from public.workspace_member_provenance_overrides where member_id = p_member_id;
  end if;
  return v_result;
end;
$$;
revoke all on function public.record_workspace_member_provenance_override(uuid, uuid, text, integer) from public, anon;
grant execute on function public.record_workspace_member_provenance_override(uuid, uuid, text, integer) to authenticated;
;
