-- Keep CSV imports reopenable without exposing imported member data or source sheets.
-- This local mirror uses the production migration identity already applied remotely.

create table if not exists public.csv_import_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'CSV import',
  source_csv text not null default '',
  parsed_sheets jsonb not null default '[]'::jsonb,
  import_rows jsonb not null default '[]'::jsonb,
  target_table text,
  enabled_sundays jsonb not null default '{}'::jsonb,
  save_result jsonb not null default '{}'::jsonb,
  source_images jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists csv_import_sessions_owner_user_updated_idx
  on public.csv_import_sessions (owner_id, user_id, updated_at desc);

alter table public.csv_import_sessions enable row level security;

revoke all on table public.csv_import_sessions from anon;
grant select, insert, update, delete on table public.csv_import_sessions to authenticated;

drop policy if exists "Users read their own CSV import sessions" on public.csv_import_sessions;
create policy "Users read their own CSV import sessions" on public.csv_import_sessions for select to authenticated
  using (auth.uid() = user_id and can_access_workspace(owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

drop policy if exists "Users create their own CSV import sessions" on public.csv_import_sessions;
create policy "Users create their own CSV import sessions" on public.csv_import_sessions for insert to authenticated
  with check (auth.uid() = user_id and can_access_workspace(owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

drop policy if exists "Users update their own CSV import sessions" on public.csv_import_sessions;
create policy "Users update their own CSV import sessions" on public.csv_import_sessions for update to authenticated
  using (auth.uid() = user_id and can_access_workspace(owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false))
  with check (auth.uid() = user_id and can_access_workspace(owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

drop policy if exists "Users delete their own CSV import sessions" on public.csv_import_sessions;
create policy "Users delete their own CSV import sessions" on public.csv_import_sessions for delete to authenticated
  using (auth.uid() = user_id and can_access_workspace(owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('csv-import-sources', 'csv-import-sources', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "CSV import source images read" on storage.objects;
create policy "CSV import source images read" on storage.objects for select to authenticated
  using (bucket_id = 'csv-import-sources' and exists (select 1 from public.csv_import_sessions session where session.id::text = (storage.foldername(name))[1] and session.user_id = auth.uid() and can_access_workspace(session.owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)));

drop policy if exists "CSV import source images insert" on storage.objects;
create policy "CSV import source images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'csv-import-sources' and exists (select 1 from public.csv_import_sessions session where session.id::text = (storage.foldername(name))[1] and session.user_id = auth.uid() and can_access_workspace(session.owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)));

drop policy if exists "CSV import source images update" on storage.objects;
create policy "CSV import source images update" on storage.objects for update to authenticated
  using (bucket_id = 'csv-import-sources' and exists (select 1 from public.csv_import_sessions session where session.id::text = (storage.foldername(name))[1] and session.user_id = auth.uid() and can_access_workspace(session.owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false))
  with check (bucket_id = 'csv-import-sources' and exists (select 1 from public.csv_import_sessions session where session.id::text = (storage.foldername(name))[1] and session.user_id = auth.uid() and can_access_workspace(session.owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

drop policy if exists "CSV import source images delete" on storage.objects;
create policy "CSV import source images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'csv-import-sources' and exists (select 1 from public.csv_import_sessions session where session.id::text = (storage.foldername(name))[1] and session.user_id = auth.uid() and can_access_workspace(session.owner_id) and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)));
