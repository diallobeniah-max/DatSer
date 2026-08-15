-- Disposable-Postgres regression fixture for migration
-- 20260813170000_harden_paper_scan_final_save.sql.
--
-- Run only after the DatSer migrations in an isolated Supabase/Postgres test
-- database. It rolls back every fixture row and table. It proves that the
-- same collaborator may be active in A and B without making a member from A
-- addressable through B's Final Save or cross-month RPC.

begin;

do $$
declare
  owner_a uuid := '00000000-0000-4000-8000-0000000000a1';
  owner_b uuid := '00000000-0000-4000-8000-0000000000b1';
  collaborator_c uuid := '00000000-0000-4000-8000-0000000000c1';
  pending_d uuid := '00000000-0000-4000-8000-0000000000c2';
  inactive_e uuid := '00000000-0000-4000-8000-0000000000c3';
  unrelated_f uuid := '00000000-0000-4000-8000-0000000000c4';
  anonymous_g uuid := '00000000-0000-4000-8000-0000000000c5';
  member_x uuid := '00000000-0000-4000-8000-0000000000d1';
  member_y uuid := '00000000-0000-4000-8000-0000000000e1';
  scan_a uuid := '00000000-0000-4000-8000-0000000000f0';
  scan_b uuid := '00000000-0000-4000-8000-0000000000f1';
  op_a uuid := '00000000-0000-4000-8000-000000000101';
  op_b_x uuid := '00000000-0000-4000-8000-000000000102';
  op_b_y uuid := '00000000-0000-4000-8000-000000000103';
  step_a uuid := '00000000-0000-4000-8000-000000000201';
  step_b_x uuid := '00000000-0000-4000-8000-000000000202';
  step_b_y uuid := '00000000-0000-4000-8000-000000000203';
  response jsonb;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (owner_a, 'authenticated', 'authenticated', 'provenance-owner-a@example.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (owner_b, 'authenticated', 'authenticated', 'provenance-owner-b@example.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (collaborator_c, 'authenticated', 'authenticated', 'provenance-collaborator@example.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (pending_d, 'authenticated', 'authenticated', 'provenance-pending@example.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (inactive_e, 'authenticated', 'authenticated', 'provenance-inactive@example.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (unrelated_f, 'authenticated', 'authenticated', 'provenance-unrelated@example.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (anonymous_g, 'authenticated', 'authenticated', 'provenance-anonymous@example.test', 'x', '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.collaborators (owner_id, email, collaborator_user_id, status, is_admin, role, updated_at)
  values
    (owner_a, 'provenance-collaborator@example.test', collaborator_c, 'active', false, 'member', now()),
    (owner_b, 'provenance-collaborator@example.test', collaborator_c, 'active', false, 'member', now()),
    (owner_a, 'provenance-pending@example.test', pending_d, 'pending', false, 'member', now()),
    (owner_a, 'provenance-inactive@example.test', inactive_e, 'rejected', false, 'member', now());

  create table public."January_2099" (like public."January_2026" including all);
  perform public.harden_month_workspace_provenance('January_2099');

  insert into public.workspace_member_codes (workspace_owner_id, member_id, ordinal, legacy_code, current_code, aliases)
  values
    (owner_a, member_x, 990001, 'PRA001', 'PRA001', '{}'::text[]),
    (owner_b, member_y, 990002, 'PRB001', 'PRB001', '{}'::text[]);

  insert into public."January_2099" (id, user_id, workspace_owner_id, "Full Name", "Gender", "Current Level")
  values
    (member_x, collaborator_c, owner_a, 'Member X', 'Female', 'SHS1'),
    (member_y, collaborator_c, owner_b, 'Member Y', 'Male', 'SHS1');
  perform public.lock_month_workspace_provenance('January_2099');

  insert into public.workspace_month_tables(owner_id, month_start, table_name)
  values
    (owner_a, '2099-01-01', 'January_2099'),
    (owner_b, '2099-01-01', 'January_2099');

  insert into public.paper_scan_saved (id, user_id, owner_id, name, sheet_images, extraction, review_state, attendance, usage_metadata)
  values
    (scan_a, collaborator_c, owner_a, 'Provenance test A', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb),
    (scan_b, collaborator_c, owner_b, 'Provenance test B', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);
  insert into public.paper_scan_save_operations(id, saved_scan_id, owner_id, saved_scan_user_id, actor_id, immutable_plan, plan_hash)
  values
    (op_a, scan_a, owner_a, collaborator_c, collaborator_c, '{}'::jsonb, 'a'),
    (op_b_x, scan_b, owner_b, collaborator_c, collaborator_c, '{}'::jsonb, 'bx'),
    (op_b_y, scan_b, owner_b, collaborator_c, collaborator_c, '{}'::jsonb, 'by');
  insert into public.paper_scan_save_steps(id, operation_id, step_key, kind, member_id, month_start, profile_payload)
  values
    (step_a, op_a, '1:profile', 'profile', member_x, '2099-01-01', '{"phone_number":"0200000001"}'::jsonb),
    (step_b_x, op_b_x, '1:profile', 'profile', member_x, '2099-01-01', '{"phone_number":"0200000002"}'::jsonb),
    (step_b_y, op_b_y, '1:profile', 'profile', member_y, '2099-01-01', '{"phone_number":"0200000003"}'::jsonb);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', collaborator_c, 'email', 'provenance-collaborator@example.test', 'is_anonymous', false)::text, true);
  if public.is_permanent_workspace_actor(owner_a) is not true or public.is_permanent_workspace_actor(owner_b) is not true then
    raise exception 'Active collaborator must satisfy the month RLS predicate only for assigned workspaces';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pending_d, 'email', 'provenance-pending@example.test', 'is_anonymous', false)::text, true);
  if public.is_permanent_workspace_actor(owner_a) then raise exception 'Pending collaborator must fail month RLS predicate'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', inactive_e, 'email', 'provenance-inactive@example.test', 'is_anonymous', false)::text, true);
  if public.is_permanent_workspace_actor(owner_a) then raise exception 'Inactive collaborator must fail month RLS predicate'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', unrelated_f, 'email', 'provenance-unrelated@example.test', 'is_anonymous', false)::text, true);
  if public.is_permanent_workspace_actor(owner_a) then raise exception 'Unrelated user must fail month RLS predicate'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', anonymous_g, 'email', 'provenance-anonymous@example.test', 'is_anonymous', true)::text, true);
  if public.is_permanent_workspace_actor(owner_a) then raise exception 'Anonymous user must fail month RLS predicate'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', collaborator_c, 'email', 'provenance-collaborator@example.test', 'is_anonymous', false)::text, true);

  -- The ordinary resilient/profile routes use the same immutable provenance
  -- boundary as Final Save. A collaborator shared by A and B cannot nominate
  -- B while addressing X, even though the historic actor/user_id is C.
  select public.update_member_record_resilient('January_2099', member_x, '{"Phone Number":"0200000009"}'::jsonb, owner_a, '{}'::jsonb) into response;
  if coalesce((response ->> 'success')::boolean, false) is not true then
    raise exception 'A resilient update must allow A member X';
  end if;
  begin
    perform public.resolve_member_update_target('January_2099', owner_b, member_x, '{}'::jsonb);
    raise exception 'B target resolver must reject A member X';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.update_member_record('January_2099', member_x, '{"Phone Number":"0200000010"}'::jsonb, owner_b);
    raise exception 'B direct trusted update must reject A member X';
  exception when sqlstate '42501' then null;
  end;
  select public.update_member_record_resilient('January_2099', member_y, '{"Phone Number":"0200000011"}'::jsonb, owner_b, '{}'::jsonb) into response;
  if coalesce((response ->> 'success')::boolean, false) is not true then
    raise exception 'B resilient update must allow B member Y';
  end if;

  select public.paper_scan_execute_save_step(op_a, step_a) into response;
  if coalesce((response ->> 'success')::boolean, false) is not true then
    raise exception 'A operation must update A member X';
  end if;
  select public.paper_scan_execute_save_step(op_b_y, step_b_y) into response;
  if coalesce((response ->> 'success')::boolean, false) is not true then
    raise exception 'B operation must update B member Y';
  end if;
  select public.paper_scan_execute_save_step(op_b_x, step_b_x) into response;
  if coalesce((response ->> 'success')::boolean, false) is not false then
    raise exception 'B operation must reject A member X';
  end if;

  select public.set_member_attendance_from_other_month(owner_b, '2099-01-01', '2099-01-01', member_x, '2099-01-04', 'Present', 'provenance-x') into response;
  if coalesce((response ->> 'success')::boolean, false) is not false then
    raise exception 'B cross-month attendance must reject A member X';
  end if;
  select public.set_member_attendance_from_other_month(owner_b, '2099-01-01', '2099-01-01', member_y, '2099-01-04', 'Present', 'provenance-y') into response;
  if coalesce((response ->> 'success')::boolean, false) is not true then
    raise exception 'B cross-month attendance must allow B member Y';
  end if;

  begin
    perform public.soft_delete_member('January_2099', member_x, owner_b);
    raise exception 'B soft delete must reject A member X';
  exception when sqlstate '42501' then null;
  end;
  if public.soft_delete_member('January_2099', member_y, owner_b) is not true then
    raise exception 'B soft delete must allow B member Y';
  end if;
end;
$$;

rollback;
