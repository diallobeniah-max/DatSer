-- Keep Saved Import sequence numbers monotonic even when the latest history
-- record is deleted. The counter is private; allocation stays inside the
-- authenticated, workspace-scoped creation function.

create table if not exists public.csv_import_sequence_counters (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  last_sequence integer not null check (last_sequence > 0),
  updated_at timestamptz not null default now()
);

insert into public.csv_import_sequence_counters (owner_id, last_sequence)
select owner_id, max(sequence_number)
from public.csv_import_sessions
group by owner_id
on conflict (owner_id) do update
set
  last_sequence = greatest(public.csv_import_sequence_counters.last_sequence, excluded.last_sequence),
  updated_at = now();

alter table public.csv_import_sequence_counters enable row level security;
revoke all on table public.csv_import_sequence_counters from public, anon, authenticated;

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
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_next_sequence integer;
  v_session public.csv_import_sessions;
begin
  if v_actor is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or p_user_id is null
    or p_owner_id is null
    or p_user_id is distinct from v_actor
    or not public.can_access_workspace(p_owner_id) then
    raise exception 'An authenticated workspace is required to save this import.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('csv-import-sequence:' || p_owner_id::text, 0));

  insert into public.csv_import_sequence_counters (owner_id, last_sequence)
  values (
    p_owner_id,
    coalesce((
      select max(sequence_number)
      from public.csv_import_sessions
      where owner_id = p_owner_id
    ), 0) + 1
  )
  on conflict (owner_id) do update
  set
    last_sequence = greatest(
      public.csv_import_sequence_counters.last_sequence,
      coalesce((
        select max(sequence_number)
        from public.csv_import_sessions
        where owner_id = p_owner_id
      ), 0)
    ) + 1,
    updated_at = now()
  returning last_sequence into v_next_sequence;

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

revoke all on function public.create_csv_import_session(uuid, uuid, text, jsonb, jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_csv_import_session(uuid, uuid, text, jsonb, jsonb, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
