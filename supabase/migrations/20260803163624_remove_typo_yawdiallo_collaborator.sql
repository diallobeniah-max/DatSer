do $$
declare
  v_owner_id uuid;
  v_collaborator_user_id uuid;
begin
  select id into v_owner_id
  from auth.users
  where lower(email) = 'diallobeniah@gmail.com'
  limit 1;

  select id into v_collaborator_user_id
  from auth.users
  where lower(email) = 'yawdiallo@gmail.co'
  limit 1;

  if v_owner_id is null then
    raise exception 'Workspace owner not found';
  end if;

  delete from public.collaborators
  where owner_id = v_owner_id
    and lower(coalesce(collaborator_email, email)) = 'yawdiallo@gmail.co';

  if v_collaborator_user_id is not null then
    delete from public.user_month_tables umt
    where umt.user_id = v_collaborator_user_id
      and exists (
        select 1
        from public.user_month_tables owner_month
        where owner_month.user_id = v_owner_id
          and owner_month.table_name = umt.table_name
      );
  end if;
end
$$;;
