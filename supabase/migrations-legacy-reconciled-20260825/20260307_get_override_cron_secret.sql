create or replace function public.get_override_cron_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'OVERRIDE_CRON_SECRET'
  order by created_at desc
  limit 1;
$$;

revoke all on function public.get_override_cron_secret() from public;
grant execute on function public.get_override_cron_secret() to service_role;
