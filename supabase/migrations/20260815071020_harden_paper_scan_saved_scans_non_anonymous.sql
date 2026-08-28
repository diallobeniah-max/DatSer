-- Paper Scan Saved Scans: explicitly deny anonymous Supabase users.

-- 1) Table row policies: anonymous identities cannot read, save, update, or
--    delete their own (or anyone's) saved scans.
drop policy if exists "Users read their own saved scans" on public.paper_scan_saved;
create policy "Users read their own saved scans" on public.paper_scan_saved
    for select to authenticated
    using (
        auth.uid() = user_id
        and public.can_access_workspace(owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

drop policy if exists "Users save their own scans" on public.paper_scan_saved;
create policy "Users save their own scans" on public.paper_scan_saved
    for insert to authenticated
    with check (
        auth.uid() = user_id
        and public.can_access_workspace(owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

drop policy if exists "Users update their own saved scans" on public.paper_scan_saved;
create policy "Users update their own saved scans" on public.paper_scan_saved
    for update to authenticated
    using (
        auth.uid() = user_id
        and public.can_access_workspace(owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
    with check (
        auth.uid() = user_id
        and public.can_access_workspace(owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

drop policy if exists "Users delete their own saved scans" on public.paper_scan_saved;
create policy "Users delete their own saved scans" on public.paper_scan_saved
    for delete to authenticated
    using (
        auth.uid() = user_id
        and public.can_access_workspace(owner_id)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

-- 2) Storage object policies: anonymous identities cannot upload, read,
--    update, or delete paper-scan objects under their (anon) uid folder.
drop policy if exists "Users upload their own saved scan sheets" on storage.objects;
create policy "Users upload their own saved scan sheets" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'paper-scan-saved'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

drop policy if exists "Users read their own saved scan sheets" on storage.objects;
create policy "Users read their own saved scan sheets" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'paper-scan-saved'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

drop policy if exists "Users update their own saved scan sheets" on storage.objects;
create policy "Users update their own saved scan sheets" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'paper-scan-saved'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    )
    with check (
        bucket_id = 'paper-scan-saved'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

drop policy if exists "Users delete their own saved scan sheets" on storage.objects;
create policy "Users delete their own saved scan sheets" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'paper-scan-saved'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    );

notify pgrst, 'reload schema';;
