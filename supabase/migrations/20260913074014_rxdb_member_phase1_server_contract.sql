-- Phase 1 / RxDB member contract.
--
-- This is deliberately forward-only. It leaves the existing resilient member
-- endpoints and production UI paths untouched, then adds a narrower trusted
-- contract for a future local-first member service.

create table if not exists public.member_v2_mutations (
  request_id text primary key check (char_length(btrim(request_id)) between 1 and 200),
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  member_id uuid not null,
  operation_name text not null check (operation_name in ('create_member_v2', 'update_member_v2')),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('PROCESSING', 'SUCCESS', 'CONFLICT', 'FAILED')),
  response jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create table if not exists public.member_v2_claims (
  member_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.member_v2_change_events (
  server_revision bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  member_id uuid not null,
  is_deleted boolean not null default false,
  operation_name text not null,
  request_id text,
  actor_id uuid references auth.users(id),
  member_payload jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists member_v2_change_events_owner_revision_idx
  on public.member_v2_change_events(owner_id, server_revision, member_id);

create table if not exists public.member_v2_heads (
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  member_id uuid not null,
  server_revision bigint not null references public.member_v2_change_events(server_revision),
  is_deleted boolean not null default false,
  member_payload jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(owner_id, table_name, member_id)
);

alter table public.member_v2_mutations enable row level security;
alter table public.member_v2_claims enable row level security;
alter table public.member_v2_change_events enable row level security;
alter table public.member_v2_heads enable row level security;

drop policy if exists "member v2 mutation owner read" on public.member_v2_mutations;
create policy "member v2 mutation owner read" on public.member_v2_mutations
  for select to authenticated using (public.has_permanent_workspace_access(owner_id));
drop policy if exists "member v2 events owner read" on public.member_v2_change_events;
create policy "member v2 events owner read" on public.member_v2_change_events
  for select to authenticated using (public.has_permanent_workspace_access(owner_id));
drop policy if exists "member v2 heads owner read" on public.member_v2_heads;
create policy "member v2 heads owner read" on public.member_v2_heads
  for select to authenticated using (public.has_permanent_workspace_access(owner_id));

revoke all on public.member_v2_mutations from public, anon, authenticated;
revoke all on public.member_v2_claims from public, anon, authenticated;
revoke all on public.member_v2_change_events from public, anon, authenticated;
revoke all on public.member_v2_heads from public, anon, authenticated;

-- A stable cross-platform canonical JSON renderer. JSONB alone has stable
-- semantics, but its textual form is not a client contract. The future RxDB
-- service can reproduce this key ordering and hash the exact resulting text.
create or replace function public.member_v2_canonical_json(p_value jsonb)
returns text
language plpgsql stable set search_path = pg_catalog, public, extensions as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_type = 'object' then
    select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || public.member_v2_canonical_json(value), ',' order by key collate "C"), '') || '}'
      into v_result
      from jsonb_each(p_value);
    return v_result;
  end if;
  if v_type = 'array' then
    select '[' || coalesce(string_agg(public.member_v2_canonical_json(value), ',' order by ordinality), '') || ']'
      into v_result
      from jsonb_array_elements(p_value) with ordinality as elements(value, ordinality);
    return v_result;
  end if;
  return p_value::text;
end;
$$;

create or replace function public.member_v2_profile_projection(p_row jsonb)
returns jsonb
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(coalesce(p_row, '{}'::jsonb))
  where key = any(array[
    'id', 'workspace_owner_id', 'user_id',
    'Full Name', 'full_name', 'Name', 'name',
    'Phone Number', 'phone_number', 'phone',
    'Gender', 'gender', 'Age', 'age',
    'Current Level', 'current_level', 'date_of_birth',
    'parent_name_1', 'parent_phone_1', 'parent_name_2', 'parent_phone_2',
    'notes', 'ministry', 'is_visitor', 'workspace',
    'Member', 'Regular', 'Newcomer', 'Manual Badge', 'Badge Type',
    'deleted_at', 'member_code'
  ]);
$$;

create or replace function public.member_v2_normalize_payload(
  p_table_name text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb) - array[
    'id', 'member_id', 'workspace_owner_id', 'user_id',
    'created_at', 'inserted_at', 'updated_at', 'deleted_at', 'member_code'
  ];
  v_source text;
  v_target text;
  v_value jsonb;
  v_key text;
  v_allowed text[] := array[
    'Full Name', 'full_name', 'Name', 'name',
    'Phone Number', 'phone_number', 'phone',
    'Gender', 'gender', 'Age', 'age',
    'Current Level', 'current_level', 'date_of_birth',
    'parent_name_1', 'parent_phone_1', 'parent_name_2', 'parent_phone_2',
    'notes', 'ministry', 'is_visitor', 'workspace',
    'Member', 'Regular', 'Newcomer', 'Manual Badge', 'Badge Type'
  ];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Member payload must be a JSON object' using errcode = '22023';
  end if;

  foreach v_source in array array['full_name', 'name', 'Name'] loop
    continue when not (v_payload ? v_source);
    v_target := case
      when public.month_table_has_column(p_table_name, 'Full Name') then 'Full Name'
      when public.month_table_has_column(p_table_name, 'full_name') then 'full_name'
      when public.month_table_has_column(p_table_name, 'Name') then 'Name'
      else 'name'
    end;
    v_value := v_payload -> v_source;
    if v_payload ? v_target and (v_payload -> v_target) is distinct from v_value then
      raise exception 'Conflicting aliases for member name' using errcode = '22023';
    end if;
    v_payload := (v_payload - v_source) || jsonb_build_object(v_target, v_value);
  end loop;

  foreach v_source in array array['phone_number', 'phone'] loop
    continue when not (v_payload ? v_source);
    v_target := case when public.month_table_has_column(p_table_name, 'Phone Number') then 'Phone Number' else 'phone_number' end;
    v_value := v_payload -> v_source;
    if v_payload ? v_target and (v_payload -> v_target) is distinct from v_value then
      raise exception 'Conflicting aliases for member phone number' using errcode = '22023';
    end if;
    v_payload := (v_payload - v_source) || jsonb_build_object(v_target, v_value);
  end loop;

  foreach v_source in array array['gender', 'age', 'current_level'] loop
    continue when not (v_payload ? v_source);
    v_target := case v_source
      when 'gender' then case when public.month_table_has_column(p_table_name, 'Gender') then 'Gender' else 'gender' end
      when 'age' then case when public.month_table_has_column(p_table_name, 'Age') then 'Age' else 'age' end
      else case when public.month_table_has_column(p_table_name, 'Current Level') then 'Current Level' else 'current_level' end
    end;
    v_value := v_payload -> v_source;
    if v_payload ? v_target and (v_payload -> v_target) is distinct from v_value then
      raise exception 'Conflicting aliases for member profile field' using errcode = '22023';
    end if;
    v_payload := (v_payload - v_source) || jsonb_build_object(v_target, v_value);
  end loop;

  for v_key in select key from jsonb_each(v_payload) loop
    if not v_key = any(v_allowed) or not public.month_table_has_column(p_table_name, v_key) then
      raise exception 'Unsupported member field' using errcode = '22023';
    end if;
  end loop;
  return v_payload;
end;
$$;

create or replace function public.member_v2_fingerprint(
  p_operation text,
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid,
  p_base_server_revision bigint,
  p_payload jsonb
) returns text
language sql stable set search_path = pg_catalog, public, extensions as $$
  select encode(extensions.digest(public.member_v2_canonical_json(jsonb_build_object(
    'base_server_revision', p_base_server_revision,
    'member_id', p_member_id::text,
    'operation', p_operation,
    'owner_id', p_owner_id::text,
    'payload', coalesce(p_payload, '{}'::jsonb),
    'table_name', p_table_name
  )), 'sha256'), 'hex');
$$;

create or replace function public.member_v2_member_payload(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_include_deleted boolean default true
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_row jsonb;
  v_has_deleted boolean;
  v_code text;
begin
  v_has_deleted := public.month_table_has_column(p_table_name, 'deleted_at');
  execute format(
    'select to_jsonb(t) from public.%I t where t.id = $1 and t.workspace_owner_id = $2%s',
    p_table_name,
    case when p_include_deleted then '' when v_has_deleted then ' and t.deleted_at is null' else '' end
  ) into v_row using p_member_id, p_owner_id;
  if v_row is null then
    return null;
  end if;
  select current_code into v_code
  from public.workspace_member_codes
  where workspace_owner_id = p_owner_id and member_id = p_member_id;
  return public.member_v2_profile_projection(v_row) || jsonb_build_object(
    '__source_table', p_table_name,
    '__canonical_member_id', p_member_id::text,
    'member_code', v_code
  );
end;
$$;

create or replace function public.member_v2_record_change(
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid,
  p_member_payload jsonb,
  p_is_deleted boolean,
  p_operation_name text,
  p_request_id text default null,
  p_actor_id uuid default null
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_revision bigint;
  v_payload jsonb := coalesce(p_member_payload, '{}'::jsonb);
begin
  insert into public.member_v2_change_events(
    owner_id, table_name, member_id, is_deleted, operation_name, request_id, actor_id, member_payload
  ) values (
    p_owner_id, p_table_name, p_member_id, coalesce(p_is_deleted, false), p_operation_name,
    p_request_id, p_actor_id, v_payload
  ) returning server_revision into v_revision;

  insert into public.member_v2_heads(
    owner_id, table_name, member_id, server_revision, is_deleted, member_payload, updated_at
  ) values (
    p_owner_id, p_table_name, p_member_id, v_revision, coalesce(p_is_deleted, false), v_payload, clock_timestamp()
  ) on conflict (owner_id, table_name, member_id) do update set
    server_revision = excluded.server_revision,
    is_deleted = excluded.is_deleted,
    member_payload = excluded.member_payload,
    updated_at = excluded.updated_at;
  return v_revision;
end;
$$;

create or replace function public.member_v2_capture_month_row()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old_projection jsonb := case when tg_op = 'UPDATE' then public.member_v2_profile_projection(to_jsonb(old)) else null end;
  v_projection jsonb := public.member_v2_profile_projection(v_row);
  v_owner_id uuid;
  v_member_id uuid;
  v_deleted boolean;
begin
  if current_setting('datser.member_v2.skip_capture', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and v_old_projection is not distinct from v_projection then
    return new;
  end if;
  begin
    v_owner_id := nullif(v_row ->> 'workspace_owner_id', '')::uuid;
    v_member_id := nullif(v_row ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end;
  if v_owner_id is null or v_member_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  v_deleted := nullif(v_row ->> 'deleted_at', '') is not null or tg_op = 'DELETE';
  perform public.member_v2_record_change(
    v_owner_id,
    tg_table_name,
    v_member_id,
    coalesce(public.member_v2_member_payload(tg_table_name, v_owner_id, v_member_id, true), v_projection) ||
      case when tg_op = 'DELETE' then jsonb_build_object('id', v_member_id::text, '__source_table', tg_table_name, '__canonical_member_id', v_member_id::text) else '{}'::jsonb end,
    v_deleted,
    lower(tg_op),
    null,
    auth.uid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.member_v2_install_month_capture_trigger(p_table_name text)
returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_trigger_name text;
begin
  if p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'
     or to_regclass(format('public.%I', p_table_name)) is null
     or not public.month_table_has_column(p_table_name, 'workspace_owner_id') then
    raise exception 'Invalid trusted month table' using errcode = '22023';
  end if;
  v_trigger_name := left('member_v2_capture_' || lower(p_table_name), 63);
  execute format('drop trigger if exists %I on public.%I', v_trigger_name, p_table_name);
  execute format(
    'create trigger %I after insert or update or delete on public.%I for each row execute function public.member_v2_capture_month_row()',
    v_trigger_name, p_table_name
  );
end;
$$;

create or replace function public.member_v2_install_month_capture_from_registry()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.member_v2_install_month_capture_trigger(new.table_name);
  return new;
end;
$$;

drop trigger if exists member_v2_install_capture_from_registry on public.workspace_month_tables;
create trigger member_v2_install_capture_from_registry
after insert or update of table_name on public.workspace_month_tables
for each row execute function public.member_v2_install_month_capture_from_registry();

do $$
declare v_table text;
begin
  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'
      and exists (
        select 1 from information_schema.columns ic
        where ic.table_schema = 'public' and ic.table_name = c.relname and ic.column_name = 'workspace_owner_id'
      )
  loop
    perform public.member_v2_install_month_capture_trigger(v_table);
  end loop;
end;
$$;

create or replace function public.member_v2_bootstrap_head(
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_existing bigint;
  v_payload jsonb;
  v_deleted boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'member_v2_head:' || p_owner_id::text || ':' || p_table_name || ':' || p_member_id::text,
    0
  ));
  select server_revision into v_existing
  from public.member_v2_heads
  where owner_id = p_owner_id and table_name = p_table_name and member_id = p_member_id
  for update;
  if v_existing is not null then
    return v_existing;
  end if;
  v_payload := public.member_v2_member_payload(p_table_name, p_owner_id, p_member_id, true);
  if v_payload is null then
    raise exception 'Member is unavailable for synchronization' using errcode = '42501';
  end if;
  v_deleted := nullif(v_payload ->> 'deleted_at', '') is not null;
  return public.member_v2_record_change(
    p_owner_id, p_table_name, p_member_id, v_payload, v_deleted, 'bootstrap', null, auth.uid()
  );
end;
$$;

create or replace function public.member_v2_bootstrap_workspace(p_owner_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r record;
  v_member_id uuid;
  v_has_deleted boolean;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  for r in
    select distinct table_name
    from public.workspace_month_tables
    where owner_id = p_owner_id
  loop
    v_has_deleted := public.month_table_has_column(r.table_name, 'deleted_at');
    for v_member_id in execute format(
      'select id from public.%I where workspace_owner_id = $1%s order by id',
      r.table_name,
      case when v_has_deleted then '' else '' end
    ) using p_owner_id loop
      perform public.member_v2_bootstrap_head(p_owner_id, r.table_name, v_member_id);
    end loop;
  end loop;
end;
$$;

create or replace function public.member_v2_reserve_mutation(
  p_request_id text,
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid,
  p_operation_name text,
  p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_existing public.member_v2_mutations%rowtype;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'Request id is required' using errcode = '22023';
  end if;
  select * into v_existing from public.member_v2_mutations where request_id = p_request_id for update;
  if found then
    if v_existing.owner_id <> p_owner_id
       or v_existing.table_name <> p_table_name
       or v_existing.member_id <> p_member_id
       or v_existing.operation_name <> p_operation_name
       or v_existing.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'Request id was already used for a different member mutation' using errcode = '22023';
    end if;
    if v_existing.response is not null then
      return jsonb_build_object(
        'reserved', false,
        'response', v_existing.response || jsonb_build_object('status', 'IDEMPOTENT_REPLAY', 'original_status', v_existing.status)
      );
    end if;
    return jsonb_build_object('reserved', false, 'response', jsonb_build_object('status', 'IN_PROGRESS', 'request_id', p_request_id));
  end if;
  insert into public.member_v2_mutations(
    request_id, owner_id, table_name, member_id, operation_name, payload_fingerprint, status, created_by
  ) values (
    p_request_id, p_owner_id, p_table_name, p_member_id, p_operation_name, p_payload_fingerprint, 'PROCESSING', auth.uid()
  );
  return jsonb_build_object('reserved', true);
end;
$$;

create or replace function public.member_v2_finish_mutation(
  p_request_id text,
  p_status text,
  p_response jsonb
) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  update public.member_v2_mutations
  set status = p_status, response = p_response, completed_at = clock_timestamp()
  where request_id = p_request_id;
  if not found then
    raise exception 'Mutation reservation was lost' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.create_member_v2(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_member jsonb,
  p_request_id text,
  p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_table text;
  v_payload jsonb;
  v_expected_fingerprint text;
  v_reservation jsonb;
  v_column text;
  v_column_type text;
  v_columns text := 'id, workspace_owner_id, user_id';
  v_values text := '$1, $2, $2';
  v_row jsonb;
  v_revision bigint;
  v_response jsonb;
begin
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_member_id is null then
    raise exception 'Client-generated member UUID is required' using errcode = '22023';
  end if;
  v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, p_table_name);
  if p_member ? 'id' and nullif(p_member ->> 'id', '')::uuid <> p_member_id then
    raise exception 'Payload member id does not match target member id' using errcode = '22023';
  end if;
  v_payload := public.member_v2_normalize_payload(v_table, p_member);
  if coalesce(nullif(btrim(coalesce(v_payload ->> 'Full Name', v_payload ->> 'full_name', v_payload ->> 'Name', v_payload ->> 'name', '')), ''), '') = '' then
    raise exception 'Member full name is required' using errcode = '22023';
  end if;
  v_expected_fingerprint := public.member_v2_fingerprint('create_member_v2', p_owner_id, v_table, p_member_id, null, v_payload);
  if lower(coalesce(p_payload_fingerprint, '')) <> v_expected_fingerprint then
    raise exception 'Payload fingerprint does not match the canonical member mutation' using errcode = '22023';
  end if;
  v_reservation := public.member_v2_reserve_mutation(p_request_id, p_owner_id, v_table, p_member_id, 'create_member_v2', v_expected_fingerprint);
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then
    return v_reservation -> 'response';
  end if;

  if exists (select 1 from public.member_v2_claims where member_id = p_member_id) then
    raise exception 'Client member UUID is already claimed' using errcode = '23505';
  end if;
  if exists (select 1 from public.member_v2_heads where member_id = p_member_id) then
    raise exception 'Client member UUID already exists in member history' using errcode = '23505';
  end if;

  for v_column, v_column_type in
    select attribute.attname, format_type(attribute.atttypid, attribute.atttypmod)
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = to_regclass(format('public.%I', v_table))
      and attribute.attnum > 0
      and not attribute.attisdropped
      and v_payload ? attribute.attname
    order by attribute.attnum
  loop
    v_columns := v_columns || ', ' || format('%I', v_column);
    v_values := v_values || format(', (($3 ->> %L)::%s)', v_column, v_column_type);
  end loop;

  perform set_config('datser.member_v2.skip_capture', 'on', true);
  execute format('insert into public.%I (%s) values (%s)', v_table, v_columns, v_values)
    using p_member_id, p_owner_id, v_payload;
  insert into public.member_v2_claims(member_id, owner_id, table_name)
  values (p_member_id, p_owner_id, v_table);
  perform public.ensure_workspace_member_code(p_owner_id, jsonb_build_object('id', p_member_id));
  v_row := public.member_v2_member_payload(v_table, p_owner_id, p_member_id, false);
  if v_row is null or nullif(v_row ->> 'member_code', '') is null then
    raise exception 'Member code allocation did not complete' using errcode = 'P0001';
  end if;
  v_revision := public.member_v2_record_change(p_owner_id, v_table, p_member_id, v_row, false, 'create_member_v2', p_request_id, v_actor);
  v_response := jsonb_build_object(
    'status', 'SUCCESS', 'request_id', p_request_id, 'member_id', p_member_id,
    'table_name', v_table, 'server_revision', v_revision, 'member', v_row
  );
  perform public.member_v2_finish_mutation(p_request_id, 'SUCCESS', v_response);
  return v_response;
end;
$$;

create or replace function public.update_member_v2(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_updates jsonb,
  p_base_server_revision bigint,
  p_request_id text,
  p_payload_fingerprint text,
  p_identity jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid;
  v_target jsonb;
  v_table text;
  v_updates jsonb;
  v_expected_fingerprint text;
  v_reservation jsonb;
  v_current_revision bigint;
  v_current_member jsonb;
  v_row jsonb;
  v_revision bigint;
  v_response jsonb;
begin
  v_actor := public.require_permanent_workspace_actor(p_owner_id, false);
  if p_base_server_revision is null or p_base_server_revision < 1 then
    raise exception 'A positive base server revision is required' using errcode = '22023';
  end if;
  v_target := public.resolve_member_update_target(p_table_name, p_owner_id, p_member_id, p_identity);
  v_table := v_target ->> 'table_name';
  v_updates := public.member_v2_normalize_payload(v_table, p_updates);
  if v_updates = '{}'::jsonb then
    raise exception 'At least one supported profile field is required' using errcode = '22023';
  end if;
  v_expected_fingerprint := public.member_v2_fingerprint('update_member_v2', p_owner_id, v_table, p_member_id, p_base_server_revision, v_updates);
  if lower(coalesce(p_payload_fingerprint, '')) <> v_expected_fingerprint then
    raise exception 'Payload fingerprint does not match the canonical member mutation' using errcode = '22023';
  end if;
  v_reservation := public.member_v2_reserve_mutation(p_request_id, p_owner_id, v_table, p_member_id, 'update_member_v2', v_expected_fingerprint);
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then
    return v_reservation -> 'response';
  end if;

  v_current_revision := public.member_v2_bootstrap_head(p_owner_id, v_table, p_member_id);
  select member_payload into v_current_member
  from public.member_v2_heads
  where owner_id = p_owner_id and table_name = v_table and member_id = p_member_id
  for update;
  if v_current_revision <> p_base_server_revision then
    v_response := jsonb_build_object(
      'status', 'CONFLICT', 'request_id', p_request_id, 'member_id', p_member_id,
      'table_name', v_table, 'base_server_revision', p_base_server_revision,
      'server_revision', v_current_revision, 'member', v_current_member
    );
    perform public.member_v2_finish_mutation(p_request_id, 'CONFLICT', v_response);
    return v_response;
  end if;

  perform set_config('datser.member_v2.skip_capture', 'on', true);
  perform public.update_member_record(v_table, p_member_id, v_updates || jsonb_build_object('updated_at', to_jsonb(clock_timestamp())), p_owner_id);
  v_row := public.member_v2_member_payload(v_table, p_owner_id, p_member_id, false);
  if v_row is null then
    raise exception 'Member update verification failed' using errcode = '42501';
  end if;
  v_revision := public.member_v2_record_change(p_owner_id, v_table, p_member_id, v_row, false, 'update_member_v2', p_request_id, v_actor);
  v_response := jsonb_build_object(
    'status', 'SUCCESS', 'request_id', p_request_id, 'member_id', p_member_id,
    'table_name', v_table, 'base_server_revision', p_base_server_revision,
    'server_revision', v_revision, 'member', v_row
  );
  perform public.member_v2_finish_mutation(p_request_id, 'SUCCESS', v_response);
  return v_response;
end;
$$;

create or replace function public.pull_workspace_member_changes_v2(
  p_owner_id uuid,
  p_after_server_revision bigint default null,
  p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_changes jsonb;
  v_next_revision bigint;
  v_has_more boolean;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Pull limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_after_server_revision is null then
    perform public.member_v2_bootstrap_workspace(p_owner_id);
  end if;
  with rows as (
    select server_revision, table_name, member_id, is_deleted, member_payload, operation_name, created_at
    from public.member_v2_change_events
    where owner_id = p_owner_id
      and server_revision > coalesce(p_after_server_revision, 0)
    order by server_revision, member_id
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'server_revision', server_revision,
    'table_name', table_name,
    'member_id', member_id,
    'is_deleted', is_deleted,
    'member', member_payload,
    'operation', operation_name,
    'changed_at', created_at
  ) order by server_revision, member_id), '[]'::jsonb), max(server_revision)
  into v_changes, v_next_revision
  from rows;
  select exists(
    select 1 from public.member_v2_change_events
    where owner_id = p_owner_id and server_revision > coalesce(v_next_revision, p_after_server_revision, 0)
  ) into v_has_more;
  return jsonb_build_object(
    'status', 'SUCCESS',
    'changes', v_changes,
    'next_cursor', v_next_revision,
    'has_more', v_has_more
  );
end;
$$;

revoke all on function public.member_v2_canonical_json(jsonb) from public, anon, authenticated;
revoke all on function public.member_v2_profile_projection(jsonb) from public, anon, authenticated;
revoke all on function public.member_v2_normalize_payload(text, jsonb) from public, anon, authenticated;
revoke all on function public.member_v2_fingerprint(text, uuid, text, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.member_v2_member_payload(text, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.member_v2_record_change(uuid, text, uuid, jsonb, boolean, text, text, uuid) from public, anon, authenticated;
revoke all on function public.member_v2_capture_month_row() from public, anon, authenticated;
revoke all on function public.member_v2_install_month_capture_trigger(text) from public, anon, authenticated;
revoke all on function public.member_v2_install_month_capture_from_registry() from public, anon, authenticated;
revoke all on function public.member_v2_bootstrap_head(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.member_v2_bootstrap_workspace(uuid) from public, anon, authenticated;
revoke all on function public.member_v2_reserve_mutation(text, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.member_v2_finish_mutation(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_member_v2(text, uuid, uuid, jsonb, text, text) from public, anon;
revoke all on function public.update_member_v2(text, uuid, uuid, jsonb, bigint, text, text, jsonb) from public, anon;
revoke all on function public.pull_workspace_member_changes_v2(uuid, bigint, integer) from public, anon;
grant execute on function public.create_member_v2(text, uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.update_member_v2(text, uuid, uuid, jsonb, bigint, text, text, jsonb) to authenticated;
grant execute on function public.pull_workspace_member_changes_v2(uuid, bigint, integer) to authenticated;

notify pgrst, 'reload schema';
