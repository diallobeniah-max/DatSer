-- Operator-verified historic member provenance exclusions and hardened override synchronization.
-- This migration creates the dedicated infrastructure for explicitly excluding
-- verified invalid historic placeholder rows from workspace ownership backfill without
-- treating them as real members, and enforces reciprocal transaction locks and strict validation.

create table if not exists public.workspace_member_provenance_exclusions (
  member_id uuid primary key,
  exclusion_reason text not null default 'blank_legacy_placeholder'
    check (exclusion_reason in ('blank_legacy_placeholder', 'operator_confirmed_sparse_legacy_placeholder', 'invalid_historic_artifact')),
  resolution_source text not null default 'operator_verified'
    check (resolution_source = 'operator_verified'),
  excluded_by uuid not null references auth.users(id),
  excluded_at timestamptz not null default now(),
  reconciliation_version integer not null default 1 check (reconciliation_version > 0),
  reconciliation_note text null check (char_length(coalesce(reconciliation_note, '')) <= 1000)
);

alter table public.workspace_member_provenance_exclusions enable row level security;
revoke all on table public.workspace_member_provenance_exclusions from public, anon, authenticated;

-- Helper 1: Strict validator for blank legacy placeholders.
-- Rejects placeholder status if ANY historic month table row contains meaningful:
-- Name, Phone, DOB, Gender, Level, Parent/Guardian details, Notes, or Attendance marks.
create or replace function public.is_valid_historic_blank_placeholder(p_member_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r record;
  col record;
  v_found boolean := false;
  v_has_identity boolean;
  v_has_attendance boolean;
  v_identity_exprs text[];
  v_attendance_exprs text[];
  v_col_lower text;
begin
  if p_member_id is null then
    return false;
  end if;

  for r in select c.relname::text as table_name
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
      and exists (
        select 1 from information_schema.columns 
        where table_schema = 'public' and table_name = c.relname and column_name = 'id'
      )
  loop
    v_identity_exprs := array[]::text[];
    v_attendance_exprs := array[]::text[];

    for col in
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = r.table_name
    loop
      v_col_lower := lower(col.column_name);

      -- Name checks
      if v_col_lower in ('full name', 'full_name', 'name') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null and lower(trim(%I)) !~ ''^(test|dummy|asdf|xxx|null|none)$'')', col.column_name, col.column_name));
      -- Phone checks
      elsif v_col_lower in ('phone number', 'phone_number', 'phone', 'mobile') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(regexp_replace(coalesce(%I, ''''), ''[^0-9]'', '''', ''g''), '''') is not null)', col.column_name));
      -- DOB checks
      elsif v_col_lower in ('date_of_birth', 'date of birth', 'dob', 'birth_date', 'birthdate') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I::text, '''')), '''') is not null)', col.column_name));
      -- Gender checks
      elsif v_col_lower in ('gender', 'sex') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null)', col.column_name));
      -- Level checks
      elsif v_col_lower in ('current level', 'current_level', 'level', 'class', 'grade') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null)', col.column_name));
      -- Parent/Guardian names
      elsif v_col_lower in ('parent_name_1', 'parent_name_2', 'guardian_name', 'father_name', 'mother_name') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null)', col.column_name));
      -- Parent/Guardian phones
      elsif v_col_lower in ('parent_phone_1', 'parent_phone_2', 'guardian_phone', 'father_phone', 'mother_phone') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(regexp_replace(coalesce(%I, ''''), ''[^0-9]'', '''', ''g''), '''') is not null)', col.column_name));
      -- Notes
      elsif v_col_lower in ('notes', 'note', 'remarks') then
        v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null)', col.column_name));
      -- Attendance
      elsif v_col_lower like 'attendance_%' then
        v_attendance_exprs := array_append(v_attendance_exprs, format('(%I is not null and %I::text not in ('''', ''false'', ''0''))', col.column_name, col.column_name));
      end if;
    end loop;

    -- Check if member exists in this table
    execute format('select exists (select 1 from public.%I where id = $1)', r.table_name)
      into v_has_identity using p_member_id;
    
    if v_has_identity then
      v_found := true;

      -- Check identity
      if array_length(v_identity_exprs, 1) > 0 then
        execute format('select exists (select 1 from public.%I where id = $1 and (%s))', r.table_name, array_to_string(v_identity_exprs, ' or '))
          into v_has_identity using p_member_id;
        if v_has_identity then
          return false;
        end if;
      end if;

      -- Check attendance
      if array_length(v_attendance_exprs, 1) > 0 then
        execute format('select exists (select 1 from public.%I where id = $1 and (%s))', r.table_name, array_to_string(v_attendance_exprs, ' or '))
          into v_has_attendance using p_member_id;
        if v_has_attendance then
          return false;
        end if;
      end if;
    end if;
  end loop;

  return v_found;
end;
$$;
revoke all on function public.is_valid_historic_blank_placeholder(uuid) from public, anon, authenticated;

-- Helper 2: Conservative validator for operator-confirmed sparse legacy placeholders.
-- Verifies the UUID exists in exactly ONE physical historic month row across ALL tables,
-- has ZERO code claims in workspace_member_codes, ZERO overrides, ZERO attendance,
-- NO name, NO phone, NO level, NO parent/guardian data, NO notes, and NO direct historic member-code values.
-- It tolerates only sparse stray attributes (e.g., stray gender, age, or DOB).
create or replace function public.is_valid_historic_sparse_legacy_placeholder(p_member_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r record;
  col record;
  v_occurrences integer := 0;
  v_table_rows integer := 0;
  v_has_hard_identity boolean;
  v_has_attendance boolean;
  v_identity_exprs text[];
  v_attendance_exprs text[];
  v_col_lower text;
  v_candidate_count integer;
begin
  if p_member_id is null then
    return false;
  end if;

  -- 1. Check workspace_member_codes claims
  select count(*) into v_candidate_count
  from public.workspace_member_codes where member_id = p_member_id;
  if v_candidate_count > 0 then
    return false;
  end if;

  -- 2. Check workspace_member_provenance_overrides
  if exists (select 1 from public.workspace_member_provenance_overrides where member_id = p_member_id) then
    return false;
  end if;

  -- 3. Scan all month tables counting total physical rows
  for r in select c.relname::text as table_name
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
      and exists (
        select 1 from information_schema.columns 
        where table_schema = 'public' and table_name = c.relname and column_name = 'id'
      )
  loop
    -- Count physical rows matching this UUID in this table
    execute format('select count(*) from public.%I where id = $1', r.table_name)
      into v_table_rows using p_member_id;

    if v_table_rows > 0 then
      v_occurrences := v_occurrences + v_table_rows;

      -- If more than 1 physical row total across tables or within same table, reject
      if v_occurrences > 1 then
        return false;
      end if;

      v_identity_exprs := array[]::text[];
      v_attendance_exprs := array[]::text[];

      for col in
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = r.table_name
      loop
        v_col_lower := lower(col.column_name);

        -- Disqualifying identity evidence for sparse placeholders:
        -- Name, Phone, Level, Parents/Guardians, Notes, and Member Codes/Badges
        if v_col_lower in ('full name', 'full_name', 'name') then
          v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null and lower(trim(%I)) !~ ''^(test|dummy|asdf|xxx|null|none)$'')', col.column_name, col.column_name));
        elsif v_col_lower in ('phone number', 'phone_number', 'phone', 'mobile') then
          v_identity_exprs := array_append(v_identity_exprs, format('(nullif(regexp_replace(coalesce(%I, ''''), ''[^0-9]'', '''', ''g''), '''') is not null)', col.column_name));
        elsif v_col_lower in ('current level', 'current_level', 'level', 'class', 'grade') then
          v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null)', col.column_name));
        elsif v_col_lower in ('parent_name_1', 'parent_name_2', 'guardian_name', 'father_name', 'mother_name') then
          v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null)', col.column_name));
        elsif v_col_lower in ('parent_phone_1', 'parent_phone_2', 'guardian_phone', 'father_phone', 'mother_phone') then
          v_identity_exprs := array_append(v_identity_exprs, format('(nullif(regexp_replace(coalesce(%I, ''''), ''[^0-9]'', '''', ''g''), '''') is not null)', col.column_name));
        elsif v_col_lower in ('notes', 'note', 'remarks') then
          v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I, '''')), '''') is not null)', col.column_name));
        -- Direct member-code / badge column check in historic table
        elsif v_col_lower in ('member_code', 'member code', 'member_id_code', 'code', 'membership_code', 'manual badge', 'manual_badge', 'badge type', 'badge_type', 'badge_code', 'badge_number', 'badge_id') then
          v_identity_exprs := array_append(v_identity_exprs, format('(nullif(trim(coalesce(%I::text, '''')), '''') is not null and lower(trim(%I::text)) not in ('''', ''none'', ''null'', ''false'', ''0''))', col.column_name, col.column_name));
        elsif v_col_lower like 'attendance_%' then
          v_attendance_exprs := array_append(v_attendance_exprs, format('(%I is not null and %I::text not in ('''', ''false'', ''0''))', col.column_name, col.column_name));
        end if;
      end loop;

      -- Check disqualifying identity
      if array_length(v_identity_exprs, 1) > 0 then
        execute format('select exists (select 1 from public.%I where id = $1 and (%s))', r.table_name, array_to_string(v_identity_exprs, ' or '))
          into v_has_hard_identity using p_member_id;
        if v_has_hard_identity then
          return false;
        end if;
      end if;

      -- Check attendance
      if array_length(v_attendance_exprs, 1) > 0 then
        execute format('select exists (select 1 from public.%I where id = $1 and (%s))', r.table_name, array_to_string(v_attendance_exprs, ' or '))
          into v_has_attendance using p_member_id;
        if v_has_attendance then
          return false;
        end if;
      end if;
    end if;
  end loop;

  -- Must exist in exactly ONE physical historic month row across all tables
  if v_occurrences <> 1 then
    return false;
  end if;

  return true;
end;
$$;
revoke all on function public.is_valid_historic_sparse_legacy_placeholder(uuid) from public, anon, authenticated;

-- Update occurrence feed to exclude both confirmed overrides and explicit exclusions.
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
       left join public.workspace_member_provenance_exclusions e on e.member_id = s.id
       where o.member_id is null and e.member_id is null and coalesce(c.owner_count, 0) <> 1',
      r.table_name, r.table_name
    );
  end loop;
end;
$$;
revoke all on function public.get_historic_member_provenance_review() from public, anon;
grant execute on function public.get_historic_member_provenance_review() to authenticated;

-- Hardened replacement for record_workspace_member_provenance_override with shared advisory lock and reciprocal exclusion check.
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

  -- 1. Shared canonical-member transaction lock
  perform pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));

  if not exists (select 1 from auth.users where id = p_workspace_owner_id) then
    raise exception 'Verified workspace owner does not exist' using errcode = '22023';
  end if;

  -- 2. Check exclusion does NOT exist under lock
  if exists (select 1 from public.workspace_member_provenance_exclusions where member_id = p_member_id) then
    raise exception 'Member has been marked as an excluded placeholder; remove exclusion before assigning ownership' using errcode = '23505';
  end if;

  -- 3. Candidate ledger checks
  select count(distinct workspace_owner_id)
  into v_candidate_count
  from public.workspace_member_codes where member_id = p_member_id;
  if v_candidate_count = 1 then
    raise exception 'Deterministic workspace-code provenance already owns this canonical member' using errcode = '23505';
  end if;
  if v_candidate_count > 1 then
    raise exception 'Canonical member has multiple trusted workspace owners; identity repair is required before provenance assignment' using errcode = '23505';
  end if;

  -- 4. Write override
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

-- Operator RPC to record an explicit provenance exclusion with shared advisory lock and server-side placeholder validation.
create or replace function public.record_workspace_member_provenance_exclusion(
  p_member_id uuid,
  p_exclusion_reason text default 'blank_legacy_placeholder',
  p_note text default null,
  p_reconciliation_version integer default 1
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid; v_result jsonb; v_candidate_count integer; v_is_blank boolean;
begin
  v_actor := public.require_historic_provenance_operator();
  if p_member_id is null then
    raise exception 'Member ID is required' using errcode = '22023';
  end if;
  if p_exclusion_reason not in ('blank_legacy_placeholder', 'operator_confirmed_sparse_legacy_placeholder', 'invalid_historic_artifact') then
    raise exception 'Invalid provenance exclusion reason: %', p_exclusion_reason using errcode = '22023';
  end if;

  -- 1. Shared canonical-member transaction lock
  perform pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));

  -- 2. Check ownership override does NOT exist under lock
  if exists (select 1 from public.workspace_member_provenance_overrides where member_id = p_member_id) then
    raise exception 'Member already has an active workspace ownership override; cannot exclude' using errcode = '23505';
  end if;

  -- 3. Check code ledger claims
  select count(distinct workspace_owner_id)
  into v_candidate_count
  from public.workspace_member_codes where member_id = p_member_id;
  if v_candidate_count >= 1 then
    raise exception 'Member has active workspace member code ledger claims; cannot exclude' using errcode = '23505';
  end if;

  -- 4. Server-side validation of placeholder
  if p_exclusion_reason = 'operator_confirmed_sparse_legacy_placeholder' then
    v_is_blank := public.is_valid_historic_sparse_legacy_placeholder(p_member_id);
    if not v_is_blank then
      raise exception 'Member % does not qualify as an operator-confirmed sparse legacy placeholder', p_member_id
        using errcode = '22023';
    end if;
  else
    v_is_blank := public.is_valid_historic_blank_placeholder(p_member_id);
    if not v_is_blank then
      raise exception 'Member % has substantial identity or attendance data and cannot be excluded under reason %', p_member_id, p_exclusion_reason
        using errcode = '22023';
    end if;
  end if;

  -- 5. Write exclusion
  insert into public.workspace_member_provenance_exclusions
    (member_id, exclusion_reason, resolution_source, excluded_by, reconciliation_note, reconciliation_version)
  values (p_member_id, p_exclusion_reason, 'operator_verified', v_actor, p_note, coalesce(p_reconciliation_version, 1))
  on conflict (member_id) do nothing
  returning jsonb_build_object('member_id', member_id, 'exclusion_reason', exclusion_reason,
    'excluded_by', excluded_by, 'excluded_at', excluded_at) into v_result;

  if v_result is null then
    select jsonb_build_object('member_id', member_id, 'exclusion_reason', exclusion_reason,
      'excluded_by', excluded_by, 'excluded_at', excluded_at)
    into v_result from public.workspace_member_provenance_exclusions where member_id = p_member_id;
  end if;

  return v_result;
end;
$$;
revoke all on function public.record_workspace_member_provenance_exclusion(uuid, text, text, integer) from public, anon;
grant execute on function public.record_workspace_member_provenance_exclusion(uuid, text, text, integer) to authenticated;
;
