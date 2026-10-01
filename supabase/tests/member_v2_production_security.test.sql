begin;
select plan(26);

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

select ok(has_function_privilege('authenticated', 'public.member_v2_workspace_eligible(uuid)', 'EXECUTE'),
  'authenticated clients can check an authorized workspace');
select ok(not has_function_privilege('anon', 'public.member_v2_workspace_eligible(uuid)', 'EXECUTE'),
  'anonymous clients cannot check eligibility');
select ok(not has_table_privilege('authenticated', 'public.member_v2_rollout_workspaces', 'SELECT'),
  'eligibility does not expose the rollout table');
select is((select prorettype::regtype::text from pg_proc where oid = 'public.member_v2_workspace_eligible(uuid)'::regprocedure),
  'boolean', 'eligibility exposes only a boolean');
select ok((select prosecdef and proconfig @> array['search_path=pg_catalog, public, pg_temp'] from pg_proc
  where oid = 'public.member_v2_workspace_eligible(uuid)'::regprocedure), 'eligibility pins its privileged search path');

-- Transaction-local synthetic actors only. Rollback removes every fixture.
insert into auth.users(id, email) values
  ('d4000000-0000-4000-8000-000000000001', 'eligibility-pilot@local.invalid'),
  ('d4000000-0000-4000-8000-000000000002', 'eligibility-legacy@local.invalid'),
  ('d4000000-0000-4000-8000-000000000003', 'eligibility-collaborator@local.invalid');
insert into public.member_v2_rollout_workspaces(owner_id, enabled)
  values ('d4000000-0000-4000-8000-000000000001', true);
insert into public.collaborators(owner_id, collaborator_user_id, email, status) values
  ('d4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000003', 'eligibility-collaborator@local.invalid', 'accepted');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-000000000001","is_anonymous":false}', true);
select is(public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000001'), true, 'enabled owner is eligible');
select throws_ok($$select public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000002')$$,
  '42501', 'Not authorized for this workspace', 'another owner cannot inspect eligibility');
select throws_ok($$select public.member_v2_workspace_eligible(null)$$,
  '22023', 'Workspace owner is required', 'null owner is rejected');
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-000000000002","is_anonymous":false}', true);
select is(public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000002'), false, 'missing rollout row stays ineligible');
reset role;
insert into public.member_v2_rollout_workspaces(owner_id, enabled)
  values ('d4000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select is(public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000002'), false, 'disabled rollout row stays ineligible');
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-000000000003","is_anonymous":false}', true);
select is(public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000001'), true, 'accepted collaborator can check its owner');
reset role;
update public.collaborators set status = 'pending'
  where owner_id = 'd4000000-0000-4000-8000-000000000001' and collaborator_user_id = 'd4000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000001')$$,
  '42501', 'Not authorized for this workspace', 'pending collaborator cannot check its owner');
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-000000000001","is_anonymous":true}', true);
select throws_ok($$select public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000001')$$,
  '42501', 'A permanent authenticated user is required', 'anonymous authenticated sessions are rejected');
set local role anon;
select throws_ok($$select public.member_v2_workspace_eligible('d4000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot execute the eligibility RPC');
reset role;

select * from finish();
rollback;
