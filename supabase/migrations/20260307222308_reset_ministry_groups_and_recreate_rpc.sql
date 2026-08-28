update public.user_preferences
set ministry_groups = null,
    updated_at = now();

do $$
declare
  rec record;
begin
  for rec in
    select distinct table_name
    from public.user_month_tables
    where table_name is not null and table_name <> ''
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = rec.table_name
        and column_name = 'ministry'
    ) then
      execute format('update public.%I set ministry = null', rec.table_name);
    end if;
  end loop;
end;
$$;

drop function if exists public.update_ministry_groups(text[], uuid);

create or replace function public.update_ministry_groups(
    p_ministry_groups text[],
    p_owner_id uuid
)
returns void
language plpgsql
security definer
as $$
declare
    v_requester_id uuid := auth.uid();
begin
    if v_requester_id = p_owner_id or exists (
        select 1
        from public.collaborators c
        where c.owner_id = p_owner_id
          and c.status in ('accepted', 'active')
          and (
            c.collaborator_user_id = v_requester_id
            or exists (
              select 1
              from auth.users au
              where au.id = v_requester_id
                and (c.email = au.email or c.email ilike au.email)
            )
          )
    ) then
        insert into public.user_preferences (user_id, ministry_groups, updated_at)
        values (p_owner_id, p_ministry_groups, now())
        on conflict (user_id) do update
        set ministry_groups = excluded.ministry_groups,
            updated_at = now();

        perform public.set_collaborators_ministry_groups(p_owner_id, p_ministry_groups);
        return;
    end if;

    raise exception 'Not authorized to update ministries for this workspace';
end;
$$;

grant execute on function public.update_ministry_groups(text[], uuid) to authenticated;;
