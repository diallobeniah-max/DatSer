create or replace function public.can_manage_workspace_branding(p_owner_id uuid)
returns boolean language sql security definer set search_path = public
as $$
  select auth.uid() is not null and p_owner_id is not null and (
    auth.uid() = p_owner_id or exists (
      select 1 from public.collaborators c
      where c.owner_id = p_owner_id
        and coalesce(c.is_admin, false) = true
        and c.status in ('accepted', 'active')
        and (
          c.collaborator_user_id = auth.uid()
          or exists (
            select 1 from auth.users au
            where au.id = auth.uid()
              and (c.email = au.email or c.email ilike au.email)
          )
        )
    )
  );
$$;
revoke all on function public.can_manage_workspace_branding(uuid) from public;
grant execute on function public.can_manage_workspace_branding(uuid) to authenticated;

drop policy if exists "Workspace owners upload member code branding" on storage.objects;
create policy "Workspace owners upload member code branding"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.can_manage_workspace_branding(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "Workspace owners read member code branding" on storage.objects;
create policy "Workspace owners read member code branding"
on storage.objects for select to authenticated
using (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.can_manage_workspace_branding(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "Workspace owners update member code branding" on storage.objects;
create policy "Workspace owners update member code branding"
on storage.objects for update to authenticated
using (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.can_manage_workspace_branding(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'member-code-branding'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.can_manage_workspace_branding(((storage.foldername(name))[1])::uuid)
);;
