-- Move CSV source-image object paths to owner/session/sheet/file while keeping
-- the bucket private and preserving access for every authorized workspace user.

drop policy if exists "CSV import source images read" on storage.objects;
create policy "CSV import source images read" on storage.objects for select to authenticated
using (
  bucket_id = 'csv-import-sources' and exists (
    select 1 from public.csv_import_sessions session
    where session.owner_id::text = (storage.foldername(storage.objects.name))[1]
      and session.id::text = (storage.foldername(storage.objects.name))[2]
      and can_access_workspace(session.owner_id)
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
);

drop policy if exists "CSV import source images insert" on storage.objects;
create policy "CSV import source images insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'csv-import-sources' and exists (
    select 1 from public.csv_import_sessions session
    where session.owner_id::text = (storage.foldername(storage.objects.name))[1]
      and session.id::text = (storage.foldername(storage.objects.name))[2]
      and can_access_workspace(session.owner_id)
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
);

drop policy if exists "CSV import source images update" on storage.objects;
create policy "CSV import source images update" on storage.objects for update to authenticated
using (
  bucket_id = 'csv-import-sources' and exists (
    select 1 from public.csv_import_sessions session
    where session.owner_id::text = (storage.foldername(storage.objects.name))[1]
      and session.id::text = (storage.foldername(storage.objects.name))[2]
      and can_access_workspace(session.owner_id)
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
)
with check (
  bucket_id = 'csv-import-sources' and exists (
    select 1 from public.csv_import_sessions session
    where session.owner_id::text = (storage.foldername(storage.objects.name))[1]
      and session.id::text = (storage.foldername(storage.objects.name))[2]
      and can_access_workspace(session.owner_id)
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
);

drop policy if exists "CSV import source images delete" on storage.objects;
create policy "CSV import source images delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'csv-import-sources' and exists (
    select 1 from public.csv_import_sessions session
    where session.owner_id::text = (storage.foldername(storage.objects.name))[1]
      and session.id::text = (storage.foldername(storage.objects.name))[2]
      and can_access_workspace(session.owner_id)
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
);
