-- Documents the APK release upload architecture after the Developer APK Forge upload fix.
-- Keep RLS enabled. Built APK uploads from localhost should go through the Vite
-- dev-server endpoint, which uses SUPABASE_SERVICE_ROLE_KEY server-side only.
-- Browser code must not receive the service role key.

comment on table public.app_releases is
  'DatSer Android APK release metadata. Public can read active releases. Admin/browser writes are constrained by RLS; Developer APK Forge built-file uploads use the local dev-server service-role endpoint.';

comment on function public.is_app_release_admin() is
  'Checks whether the authenticated user can manage app releases through normal Supabase RLS policies.';

update storage.buckets
set public = true,
    file_size_limit = 157286400,
    allowed_mime_types = array['application/vnd.android.package-archive', 'application/octet-stream']
where id = 'app-updates';
