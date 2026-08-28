-- Private APK update management for DatSer Android installs.

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  version_name text not null,
  version_code integer not null check (version_code > 0),
  title text not null,
  description text default '',
  apk_url text not null,
  force_update boolean not null default false,
  is_active boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_releases_active_idx
  on public.app_releases (is_active, version_code desc, published_at desc);

create or replace function public.set_app_releases_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.is_active = true and old.is_active = false and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists app_releases_set_updated_at on public.app_releases;
create trigger app_releases_set_updated_at
before update on public.app_releases
for each row execute function public.set_app_releases_updated_at();

create or replace function public.is_app_release_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.user_preferences
      where user_id = auth.uid()
      limit 1
    )
    or exists (
      select 1 from public.user_month_tables
      where user_id = auth.uid()
      limit 1
    )
    or exists (
      select 1 from public.collaborators
      where collaborator_user_id = auth.uid()
        and coalesce(is_admin, false) = true
        and status in ('pending', 'accepted', 'active')
      limit 1
    ),
    false
  );
$$;

alter table public.app_releases enable row level security;

drop policy if exists "Read active app releases" on public.app_releases;
create policy "Read active app releases"
on public.app_releases
for select
using (is_active = true or public.is_app_release_admin());

drop policy if exists "Manage app releases" on public.app_releases;
create policy "Manage app releases"
on public.app_releases
for all
using (public.is_app_release_admin())
with check (public.is_app_release_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-updates',
  'app-updates',
  true,
  157286400,
  array['application/vnd.android.package-archive', 'application/octet-stream']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Read APK update files" on storage.objects;
create policy "Read APK update files"
on storage.objects
for select
using (bucket_id = 'app-updates');

drop policy if exists "Upload APK update files" on storage.objects;
create policy "Upload APK update files"
on storage.objects
for insert
with check (
  bucket_id = 'app-updates'
  and public.is_app_release_admin()
  and lower(name) like '%.apk'
);

drop policy if exists "Update APK update files" on storage.objects;
create policy "Update APK update files"
on storage.objects
for update
using (bucket_id = 'app-updates' and public.is_app_release_admin())
with check (bucket_id = 'app-updates' and public.is_app_release_admin());

drop policy if exists "Delete APK update files" on storage.objects;
create policy "Delete APK update files"
on storage.objects
for delete
using (bucket_id = 'app-updates' and public.is_app_release_admin());
