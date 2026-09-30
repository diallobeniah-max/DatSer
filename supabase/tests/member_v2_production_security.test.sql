begin;
select plan(12);

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
  not has_function_privilege('anon', 'public.member_v2_lock_change_event_order(uuid)', 'EXECUTE'),
  'anonymous callers cannot acquire the internal change-feed ordering lock'
);
select ok(
  not has_function_privilege('authenticated', 'public.member_v2_lock_change_event_order(uuid)', 'EXECUTE'),
  'authenticated callers cannot acquire the internal change-feed ordering lock'
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

select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'member_v2_owner_lock_held', 'member_v2_begin_workspace_write',
      'member_v2_lock_month_statement', 'member_v2_assert_month_owner_lock',
      'member_v2_install_month_lock_triggers', 'member_v2_install_lock_from_registry'
    ) and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ),
  'lock coordination helpers cannot be called directly by API roles'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'member_v2_owner_lock_held', 'member_v2_begin_workspace_write',
      'member_v2_lock_month_statement', 'member_v2_assert_month_owner_lock',
      'member_v2_install_month_lock_triggers', 'member_v2_install_lock_from_registry'
    ) and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=pg_catalog, public, pg_temp'], false))
  ),
  'privileged lock helpers pin their search path'
);
select ok(
  not exists (
    select 1 from pg_trigger capture
    where not capture.tgisinternal and capture.tgfoid in (
      'public.member_v2_capture_month_row()'::regprocedure,
      'public.member_v2_capture_month_attendance()'::regprocedure
    ) and not exists (
      select 1 from pg_trigger coordination
      where coordination.tgrelid = capture.tgrelid
        and coordination.tgfoid = 'public.member_v2_lock_month_statement()'::regprocedure
        and coordination.tgenabled <> 'D'
        and coordination.tgtype & 1 = 0 and coordination.tgtype & 2 = 2
    )
  ),
  'every legacy capture relation coordinates locks before its statement'
);

select * from finish();
rollback;
