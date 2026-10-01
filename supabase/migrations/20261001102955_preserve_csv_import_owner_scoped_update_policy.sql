-- The September syntax repair restored the obsolete session-first policy.
-- Preserve the deployed owner/session contract used by CSV image upserts.
-- This changes only UPDATE authorization; no data or rollout state is changed.
drop policy if exists "CSV import source images update" on storage.objects;
create policy "CSV import source images update" on storage.objects
for update to authenticated
using (
  bucket_id = 'csv-import-sources' and exists (
    select 1 from public.csv_import_sessions session
    where session.owner_id::text = (storage.foldername(storage.objects.name))[1]
      and session.id::text = (storage.foldername(storage.objects.name))[2]
      and public.can_access_workspace(session.owner_id)
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
)
with check (
  bucket_id = 'csv-import-sources' and exists (
    select 1 from public.csv_import_sessions session
    where session.owner_id::text = (storage.foldername(storage.objects.name))[1]
      and session.id::text = (storage.foldername(storage.objects.name))[2]
      and public.can_access_workspace(session.owner_id)
      and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
);
