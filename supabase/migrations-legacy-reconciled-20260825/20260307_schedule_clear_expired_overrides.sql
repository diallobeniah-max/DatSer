create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'OVERRIDE_CRON_SECRET'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'OVERRIDE_CRON_SECRET',
      'Shared secret for clear-expired-overrides scheduler'
    );
  end if;
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'clear-expired-overrides-hourly'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'clear-expired-overrides-hourly',
    '0 * * * *',
    $job$
      select net.http_post(
        url := 'https://btonpncrhbyhriavelyi.supabase.co/functions/v1/clear-expired-overrides',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'OVERRIDE_CRON_SECRET'
            order by created_at desc
            limit 1
          ),
          'x-cron-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'OVERRIDE_CRON_SECRET'
            order by created_at desc
            limit 1
          )
        ),
        body := '{}'::jsonb
      );
    $job$
  );
end;
$$;
