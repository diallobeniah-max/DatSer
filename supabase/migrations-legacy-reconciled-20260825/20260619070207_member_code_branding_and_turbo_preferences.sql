alter table public.user_preferences
  add column if not exists member_code_logo_url text default null,
  add column if not exists member_code_turbo_enabled boolean default false,
  add column if not exists member_code_turbo_notification_enabled boolean default true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-code-branding',
  'member-code-branding',
  true,
  3145728,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Workspace owners upload member code branding" on storage.objects;
create policy "Workspace owners upload member code branding"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Workspace owners read member code branding" on storage.objects;
create policy "Workspace owners read member code branding"
on storage.objects for select to authenticated
using (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Workspace owners update member code branding" on storage.objects;
create policy "Workspace owners update member code branding"
on storage.objects for update to authenticated
using (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
