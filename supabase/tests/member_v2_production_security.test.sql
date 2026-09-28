begin;
select plan(7);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.member_v2_rollout_workspaces'::regclass),
  'workspace rollout allowlist has RLS enabled'
);
select ok(
  not exists (select 1 from public.member_v2_rollout_workspaces where enabled),
  'no workspace is enabled by default'
);
select ok(
  not has_function_privilege('anon', 'public.create_member_v2(text,uuid,uuid,jsonb,text,text)', 'EXECUTE'),
  'anonymous callers cannot create members through Member V2'
);
select ok(
  not has_function_privilege('anon', 'public.save_member_v2_attendance(uuid,uuid,text,date,text,uuid,bigint,text,text)', 'EXECUTE'),
  'anonymous callers cannot write Member V2 attendance'
);
select ok(
  has_function_privilege('authenticated', 'public.member_v2_source_table_capabilities(uuid,text)', 'EXECUTE'),
  'authenticated callers can use the authorized schema capability RPC'
);
select is(
  (select prorettype::regtype::text from pg_proc where oid = 'public.member_v2_source_table_capabilities(uuid,text)'::regprocedure),
  'jsonb',
  'source capability response has a stable JSON contract'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.member_v2_realtime_signals'::regclass),
  'Member V2 realtime wake signal is protected by RLS'
);

select * from finish();
rollback;
