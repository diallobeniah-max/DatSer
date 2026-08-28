-- Repair CSV history ownership and source-image policies without changing the
-- already-deployed table schema. The original Storage subquery accidentally
-- captured csv_import_sessions.name instead of storage.objects.name.

drop policy if exists "Users read their own CSV import sessions" on public.csv_import_sessions;
create policy "Workspace members read CSV import sessions"
  on public.csv_import_sessions
  for select
  to authenticated
  using (
    can_access_workspace(owner_id)
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

drop policy if exists "Users create their own CSV import sessions" on public.csv_import_sessions;
create policy "Workspace members create CSV import sessions"
  on public.csv_import_sessions
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and can_access_workspace(owner_id)
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

drop policy if exists "Users update their own CSV import sessions" on public.csv_import_sessions;
create policy "Creators and owners update CSV import sessions"
  on public.csv_import_sessions
  for update
  to authenticated
  using (
    (auth.uid() = user_id or auth.uid() = owner_id)
    and can_access_workspace(owner_id)
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
  with check (
    (auth.uid() = user_id or auth.uid() = owner_id)
    and can_access_workspace(owner_id)
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

drop policy if exists "Users delete their own CSV import sessions" on public.csv_import_sessions;
create policy "Creators and owners delete CSV import sessions"
  on public.csv_import_sessions
  for delete
  to authenticated
  using (
    (auth.uid() = user_id or auth.uid() = owner_id)
    and can_access_workspace(owner_id)
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

drop policy if exists "CSV import source images read" on storage.objects;
create policy "CSV import source images read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'csv-import-sources'
    and exists (
      select 1
      from public.csv_import_sessions session
      where session.id::text = (storage.foldername(storage.objects.name))[1]
        and can_access_workspace(session.owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
  );

drop policy if exists "CSV import source images insert" on storage.objects;
create policy "CSV import source images insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'csv-import-sources'
    and exists (
      select 1
      from public.csv_import_sessions session
      where session.id::text = (storage.foldername(storage.objects.name))[1]
        and can_access_workspace(session.owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
  );

drop policy if exists "CSV import source images update" on storage.objects;
create policy "CSV import source images update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'csv-import-sources'
    and exists (
      select 1
      from public.csv_import_sessions session
      where session.id::text = (storage.foldername(storage.objects.name))[1]
        and can_access_workspace(session.owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
  )
  with check (
    bucket_id = 'csv-import-sources'
    and exists (
      select 1
      from public.csv_import_sessions session
      where session.id::text = (storage.foldername(storage.objects.name))[1]
        and can_access_workspace(session.owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
  );

drop policy if exists "CSV import source images delete" on storage.objects;
create policy "CSV import source images delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'csv-import-sources'
    and exists (
      select 1
      from public.csv_import_sessions session
      where session.id::text = (storage.foldername(storage.objects.name))[1]
        and can_access_workspace(session.owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
  );
