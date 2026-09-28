-- Forward-only repair for the missing closing parenthesis in the historical
-- CSV source-image UPDATE policy. The applied migration version is immutable.
drop policy if exists "CSV import source images update" on storage.objects;
create policy "CSV import source images update" on storage.objects for update to authenticated
  using (
    bucket_id = 'csv-import-sources'
    and exists (
      select 1 from public.csv_import_sessions session
      where session.id::text = (storage.foldername(name))[1]
        and session.user_id = auth.uid()
        and can_access_workspace(session.owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
  )
  with check (
    bucket_id = 'csv-import-sources'
    and exists (
      select 1 from public.csv_import_sessions session
      where session.id::text = (storage.foldername(name))[1]
        and session.user_id = auth.uid()
        and can_access_workspace(session.owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
  );
