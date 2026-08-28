-- Give each workspace a durable, human-friendly CSV import sequence. The
-- sequence is allocated in the database so concurrent imports cannot reuse a
-- visible-card count, and the editable title stays metadata-only.

alter table public.csv_import_sessions
  add column if not exists sequence_number integer;

with ranked_sessions as (
  select
    id,
    row_number() over (partition by owner_id order by created_at asc, id asc)::integer as next_sequence
  from public.csv_import_sessions
)
update public.csv_import_sessions session
set
  sequence_number = ranked_sessions.next_sequence,
  name = case
    when session.name is null
      or btrim(session.name) = ''
      or btrim(session.name) = 'CSV import'
      or btrim(session.name) ~ '^[0-9]+ rows? .*'
      then format('Sheet %s', ranked_sessions.next_sequence)
    else session.name
  end
from ranked_sessions
where session.id = ranked_sessions.id;

alter table public.csv_import_sessions
  alter column sequence_number set not null;

alter table public.csv_import_sessions
  drop constraint if exists csv_import_sessions_sequence_number_positive;

alter table public.csv_import_sessions
  add constraint csv_import_sessions_sequence_number_positive
  check (sequence_number > 0);

create unique index if not exists csv_import_sessions_owner_sequence_number_key
  on public.csv_import_sessions (owner_id, sequence_number);

create or replace function public.create_csv_import_session(
  p_user_id uuid,
  p_owner_id uuid,
  p_source_csv text,
  p_parsed_sheets jsonb,
  p_import_rows jsonb,
  p_target_table text,
  p_enabled_sundays jsonb,
  p_save_result jsonb
)
returns public.csv_import_sessions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_next_sequence integer;
  v_session public.csv_import_sessions;
begin
  if p_user_id is null
    or p_owner_id is null
    or p_user_id is distinct from auth.uid() then
    raise exception 'An authenticated workspace is required to save this import.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  select coalesce(max(sequence_number), 0) + 1
    into v_next_sequence
  from public.csv_import_sessions
  where owner_id = p_owner_id;

  insert into public.csv_import_sessions (
    user_id,
    owner_id,
    name,
    sequence_number,
    source_csv,
    parsed_sheets,
    import_rows,
    target_table,
    enabled_sundays,
    save_result,
    source_images
  ) values (
    p_user_id,
    p_owner_id,
    format('Sheet %s', v_next_sequence),
    v_next_sequence,
    coalesce(p_source_csv, ''),
    coalesce(p_parsed_sheets, '[]'::jsonb),
    coalesce(p_import_rows, '[]'::jsonb),
    p_target_table,
    coalesce(p_enabled_sundays, '{}'::jsonb),
    coalesce(p_save_result, '{}'::jsonb),
    '[]'::jsonb
  )
  returning * into v_session;

  return v_session;
end;
$$;

revoke execute on function public.create_csv_import_session(uuid, uuid, text, jsonb, jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_csv_import_session(uuid, uuid, text, jsonb, jsonb, text, jsonb, jsonb) to authenticated;
