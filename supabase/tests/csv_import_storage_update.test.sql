begin;
select plan(9);

-- Synthetic metadata only; every fixture and object is rolled back.
insert into auth.users(id, email) values
  ('e4000000-0000-4000-8000-000000000001', 'csv-owner@local.invalid'),
  ('e4000000-0000-4000-8000-000000000002', 'csv-collaborator@local.invalid'),
  ('e4000000-0000-4000-8000-000000000003', 'csv-outsider@local.invalid');
insert into public.collaborators(owner_id, collaborator_user_id, email, status) values
  ('e4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'csv-collaborator@local.invalid', 'accepted');
insert into public.csv_import_sessions(id, user_id, owner_id, name, sequence_number) values
  ('e4100000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Synthetic CSV policy test', 1);
insert into storage.objects(id, bucket_id, name) values
  ('e4200000-0000-4000-8000-000000000001', 'csv-import-sources', 'e4000000-0000-4000-8000-000000000001/e4100000-0000-4000-8000-000000000001/sheet/source.png'),
  ('e4200000-0000-4000-8000-000000000002', 'csv-import-sources', 'e4100000-0000-4000-8000-000000000001/sheet/legacy.png');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e4000000-0000-4000-8000-000000000001","is_anonymous":false}', true);
with changed as (update storage.objects set metadata = '{"test":"owner"}' where id = 'e4200000-0000-4000-8000-000000000001' returning id)
select is(count(*), 1::bigint, 'owner can replace a source image at the current owner/session path') from changed;

select set_config('request.jwt.claims', '{"sub":"e4000000-0000-4000-8000-000000000002","is_anonymous":false}', true);
with changed as (update storage.objects set metadata = '{"test":"collaborator"}' where id = 'e4200000-0000-4000-8000-000000000001' returning id)
select is(count(*), 1::bigint, 'accepted collaborator can replace the workspace source image') from changed;

select set_config('request.jwt.claims', '{"sub":"e4000000-0000-4000-8000-000000000003","is_anonymous":false}', true);
with changed as (update storage.objects set metadata = '{}' where id = 'e4200000-0000-4000-8000-000000000001' returning id)
select is(count(*), 0::bigint, 'unrelated workspace cannot update the source image') from changed;

select set_config('request.jwt.claims', '{"sub":"e4000000-0000-4000-8000-000000000001","is_anonymous":true}', true);
with changed as (update storage.objects set metadata = '{}' where id = 'e4200000-0000-4000-8000-000000000001' returning id)
select is(count(*), 0::bigint, 'anonymous authenticated sessions cannot update the source image') from changed;

set local role anon;
with changed as (update storage.objects set metadata = '{}' where id = 'e4200000-0000-4000-8000-000000000001' returning id)
select is(count(*), 0::bigint, 'anon cannot update the private source image') from changed;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e4000000-0000-4000-8000-000000000001","is_anonymous":false}', true);
select throws_ok($$update storage.objects set name = 'e4000000-0000-4000-8000-000000000003/e4100000-0000-4000-8000-000000000001/sheet/source.png' where id = 'e4200000-0000-4000-8000-000000000001'$$,
  '42501', null, 'WITH CHECK rejects moving the object to another owner');
select throws_ok($$update storage.objects set name = 'e4000000-0000-4000-8000-000000000001/e4100000-0000-4000-8000-000000000002/sheet/source.png' where id = 'e4200000-0000-4000-8000-000000000001'$$,
  '42501', null, 'WITH CHECK rejects a mismatched session');
with changed as (update storage.objects set metadata = '{}' where id = 'e4200000-0000-4000-8000-000000000002' returning id)
select is(count(*), 0::bigint, 'obsolete session-first paths do not bypass owner scoping') from changed;
with changed as (update storage.objects set name = 'e4000000-0000-4000-8000-000000000001/e4100000-0000-4000-8000-000000000001/sheet/replaced.png' where id = 'e4200000-0000-4000-8000-000000000001' returning id)
select is(count(*), 1::bigint, 'WITH CHECK permits an authorized rename within the same owner/session') from changed;
reset role;

select * from finish();
rollback;
