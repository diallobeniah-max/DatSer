create or replace function public.resolve_workspace_owner_for_actor(p_actor_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.owner_id
      from public.collaborators c
      where c.collaborator_user_id = p_actor_id
        and c.status in ('pending', 'accepted', 'active')
      order by
        case c.status when 'active' then 0 when 'accepted' then 1 else 2 end,
        c.updated_at desc nulls last,
        c.created_at desc nulls last
      limit 1
    ),
    p_actor_id
  );
$$;

create or replace function public.register_collaborators_for_month(
  p_owner_id uuid,
  p_table_name text,
  p_month_year text
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before integer := 0;
  v_after integer := 0;
begin
  if p_owner_id is null or nullif(btrim(p_table_name), '') is null then
    raise exception 'Workspace owner and table name are required';
  end if;

  if auth.uid() is not null then
    perform public.authorize_workspace_actor(p_owner_id);
  end if;

  select count(*)
  into v_before
  from public.user_month_tables umt
  where umt.table_name = p_table_name
    and umt.user_id in (
      select p_owner_id
      union
      select coalesce(c.collaborator_user_id, au.id)
      from public.collaborators c
      left join auth.users au
        on lower(au.email) = lower(coalesce(c.collaborator_email, c.email))
      where c.owner_id = p_owner_id
        and c.status in ('pending', 'accepted', 'active')
        and coalesce(c.collaborator_user_id, au.id) is not null
    );

  insert into public.user_month_tables (user_id, table_name, month_year)
  select access_users.user_id, p_table_name, p_month_year
  from (
    select p_owner_id as user_id
    union
    select coalesce(c.collaborator_user_id, au.id) as user_id
    from public.collaborators c
    left join auth.users au
      on lower(au.email) = lower(coalesce(c.collaborator_email, c.email))
    where c.owner_id = p_owner_id
      and c.status in ('pending', 'accepted', 'active')
      and coalesce(c.collaborator_user_id, au.id) is not null
  ) access_users
  on conflict (user_id, table_name) do update
  set month_year = coalesce(excluded.month_year, public.user_month_tables.month_year);

  select count(*)
  into v_after
  from public.user_month_tables umt
  where umt.table_name = p_table_name
    and umt.user_id in (
      select p_owner_id
      union
      select coalesce(c.collaborator_user_id, au.id)
      from public.collaborators c
      left join auth.users au
        on lower(au.email) = lower(coalesce(c.collaborator_email, c.email))
      where c.owner_id = p_owner_id
        and c.status in ('pending', 'accepted', 'active')
        and coalesce(c.collaborator_user_id, au.id) is not null
    );

  return greatest(v_after - v_before, 0);
end;
$$;

create or replace function public.sync_workspace_month_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_owner_id := public.resolve_workspace_owner_for_actor(new.user_id);
  perform public.register_collaborators_for_month(
    v_owner_id,
    new.table_name,
    new.month_year
  );

  return new;
end;
$$;

drop trigger if exists trg_sync_workspace_month_registration
on public.user_month_tables;

create trigger trg_sync_workspace_month_registration
after insert on public.user_month_tables
for each row
execute function public.sync_workspace_month_registration();

create or replace function public.sync_collaborator_existing_months()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_collaborator_user_id uuid;
begin
  if new.status not in ('pending', 'accepted', 'active') then
    return new;
  end if;

  v_collaborator_user_id := new.collaborator_user_id;

  if v_collaborator_user_id is null then
    select au.id
    into v_collaborator_user_id
    from auth.users au
    where lower(au.email) = lower(coalesce(new.collaborator_email, new.email))
    limit 1;
  end if;

  if v_collaborator_user_id is null then
    return new;
  end if;

  insert into public.user_month_tables (user_id, table_name, month_year)
  select v_collaborator_user_id, umt.table_name, umt.month_year
  from public.user_month_tables umt
  where umt.user_id = new.owner_id
  on conflict (user_id, table_name) do update
  set month_year = coalesce(excluded.month_year, public.user_month_tables.month_year);

  return new;
end;
$$;

drop trigger if exists trg_sync_collaborator_existing_months
on public.collaborators;

create trigger trg_sync_collaborator_existing_months
after insert or update of status, collaborator_user_id, email, collaborator_email
on public.collaborators
for each row
execute function public.sync_collaborator_existing_months();

do $$
declare
  v_owner_id uuid;
  v_secondary_id uuid;
begin
  select au.id
  into v_owner_id
  from auth.users au
  where lower(au.email) = 'diallobeniah@gmail.com'
  limit 1;

  select au.id
  into v_secondary_id
  from auth.users au
  where lower(au.email) = 'datser@gmail.com'
  limit 1;

  if v_owner_id is null then
    raise exception 'Could not find diallobeniah@gmail.com';
  end if;

  if v_secondary_id is null then
    raise exception 'Could not find datser@gmail.com';
  end if;

  with workspace_users as (
    select v_owner_id as user_id
    union
    select v_secondary_id
    union
    select coalesce(c.collaborator_user_id, au.id)
    from public.collaborators c
    left join auth.users au
      on lower(au.email) = lower(coalesce(c.collaborator_email, c.email))
    where c.owner_id = v_owner_id
      and c.status in ('pending', 'accepted', 'active')
      and coalesce(c.collaborator_user_id, au.id) is not null
  ),
  workspace_months as (
    select distinct umt.table_name, umt.month_year
    from public.user_month_tables umt
    where umt.user_id in (select user_id from workspace_users)
  )
  insert into public.user_month_tables (user_id, table_name, month_year)
  select wu.user_id, wm.table_name, wm.month_year
  from workspace_users wu
  cross join workspace_months wm
  on conflict (user_id, table_name) do update
  set month_year = coalesce(excluded.month_year, public.user_month_tables.month_year);
end;
$$;;
