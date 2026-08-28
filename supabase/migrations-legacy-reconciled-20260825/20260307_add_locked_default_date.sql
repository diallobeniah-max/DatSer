alter table public.user_preferences 
add column if not exists locked_default_date text; 

create or replace function public.get_owner_locked_date(owner_uuid uuid) 
returns text 
language sql 
security definer 
set search_path = public 
as $$ 
  select locked_default_date 
  from public.user_preferences 
  where user_id = owner_uuid 
  limit 1; 
$$; 

grant execute on function public.get_owner_locked_date(uuid) to authenticated;
