-- Paper Scan Saved Scans: atomic staging metadata.

-- 1) Merge one staged sheet into the durable metadata.
create or replace function public.paper_scan_merge_staged_sheet(
    p_scan_id uuid,
    p_owner_id uuid,
    p_name text,
    p_sheet jsonb
) returns public.paper_scan_saved
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
    v_actor uuid;
    v_scan public.paper_scan_saved%rowtype;
    v_sheet_id text;
    v_path text;
    v_array jsonb;
    v_exists boolean;
begin
    v_actor := public.require_permanent_workspace_actor(p_owner_id, false);

    if p_scan_id is null or jsonb_typeof(p_sheet) <> 'object' then
        raise exception 'A scan id and a sheet object are required' using errcode = '22023';
    end if;
    v_sheet_id := p_sheet ->> 'sheetId';
    v_path := p_sheet ->> 'path';
    if nullif(btrim(v_sheet_id), '') is null or nullif(btrim(v_path), '') is null then
        raise exception 'A sheet id and an object path are required' using errcode = '22023';
    end if;
    if p_name is not null and length(btrim(p_name)) > 200 then
        raise exception 'Scan name is too long' using errcode = '22023';
    end if;

    -- Lock the durable row if it exists. A missing row is created atomically
    -- below; the ON CONFLICT path handles two first-sheets racing to INSERT.
    select * into v_scan
    from public.paper_scan_saved
    where id = p_scan_id and owner_id = p_owner_id and user_id = v_actor
    for update;

    if not found then
        insert into public.paper_scan_saved (id, user_id, owner_id, name, sheet_images, review_state)
        values (
            p_scan_id,
            v_actor,
            p_owner_id,
            coalesce(nullif(btrim(p_name), ''), 'Staged scan'),
            jsonb_build_array(p_sheet),
            jsonb_build_object('_staging', true)
        )
        on conflict (id) do nothing;
        select * into v_scan
        from public.paper_scan_saved
        where id = p_scan_id and owner_id = p_owner_id and user_id = v_actor
        for update;
        if not found then
            raise exception 'The staged scan could not be created' using errcode = '55000';
        end if;
    end if;

    -- Merge exactly one sheet into the LATEST durable array, preserving all
    -- other references. Never replace the whole array with stale client state.
    v_array := coalesce(v_scan.sheet_images, '[]'::jsonb);
    select exists(
        select 1 from jsonb_array_elements(v_array) e where e ->> 'sheetId' = v_sheet_id
    ) into v_exists;
    if v_exists then
        v_array := (
            select jsonb_agg(
                case when e ->> 'sheetId' = v_sheet_id then p_sheet else e end
            )
            from jsonb_array_elements(v_array) e
        );
    else
        v_array := v_array || jsonb_build_array(p_sheet);
    end if;

    update public.paper_scan_saved
    set sheet_images = v_array,
        review_state = jsonb_set(
            coalesce(review_state, '{}'::jsonb),
            '{_staging}',
            'true',
            true
        ),
        name = case when nullif(btrim(p_name), '') is null then name else btrim(p_name) end
    where id = v_scan.id
    returning * into v_scan;

    return v_scan;
end;
$$;
revoke all on function public.paper_scan_merge_staged_sheet(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.paper_scan_merge_staged_sheet(uuid, uuid, text, jsonb) to authenticated;

-- 2) Remove one sheet reference from durable staging metadata. Metadata only:
-- the remote storage object is NEVER deleted here.
create or replace function public.paper_scan_remove_staged_sheet(
    p_scan_id uuid,
    p_owner_id uuid,
    p_sheet_id text
) returns public.paper_scan_saved
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
    v_actor uuid;
    v_scan public.paper_scan_saved%rowtype;
    v_array jsonb;
begin
    v_actor := public.require_permanent_workspace_actor(p_owner_id, false);

    if p_scan_id is null or nullif(btrim(p_sheet_id), '') is null then
        raise exception 'A scan id and a sheet id are required' using errcode = '22023';
    end if;

    select * into v_scan
    from public.paper_scan_saved
    where id = p_scan_id and owner_id = p_owner_id and user_id = v_actor
    for update;

    if not found then
        raise exception 'The staged scan does not exist' using errcode = '42501';
    end if;

    v_array := (
        select coalesce(jsonb_agg(e), '[]'::jsonb)
        from jsonb_array_elements(coalesce(v_scan.sheet_images, '[]'::jsonb)) e
        where e ->> 'sheetId' <> p_sheet_id
    );

    update public.paper_scan_saved
    set sheet_images = v_array
    where id = v_scan.id
    returning * into v_scan;

    return v_scan;
end;
$$;
revoke all on function public.paper_scan_remove_staged_sheet(uuid, uuid, text) from public, anon;
grant execute on function public.paper_scan_remove_staged_sheet(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';;
