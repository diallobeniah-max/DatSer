// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { readLocalSupabase } from '../../experiments/rxdb-backend-poc/testing/localSupabaseFixture'

let admin
let ownerId
let results

beforeAll(async () => {
  const config = readLocalSupabase()
  admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const password = crypto.randomUUID()
  const email = crypto.randomUUID() + '@local.invalid'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  ownerId = created.data.user.id
  const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  for (const month of [11, 1]) {
    const registered = await client.rpc('create_workspace_month', { p_owner_id: ownerId, p_year: 2025, p_month: month, p_source_month: null, p_copy_mode: 'empty', p_member_ids: [] })
    if (registered.error) throw registered.error
  }
  await client.auth.signOut()
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error('Invalid synthetic owner')
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const container = execFileSync(docker, ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
  if (!container) throw new Error('Local Supabase is required')
  // All member changes, including the retained historical row, roll back.
  // Suppressed inserts model rows that existed before V2 capture was installed.
  const sql = `
begin;
select set_config('request.jwt.claims', '{"sub":"${ownerId}","role":"authenticated","is_anonymous":false}', true);
create temporary table tombstone_results (result jsonb);
do $proof$
declare
  v_owner uuid := '${ownerId}';
  v_trusted uuid := gen_random_uuid(); v_ordinary uuid := gen_random_uuid();
  v_active uuid := gen_random_uuid(); v_deleted uuid := gen_random_uuid();
  v_request text := gen_random_uuid()::text;
  v_create jsonb; v_delete jsonb; v_result jsonb;
  v_payload jsonb := '{"Full Name":"Synthetic tombstone contract","Current Level":"JHS2"}';
begin
  v_create := public.create_member_v2('November_2025', v_owner, v_trusted, v_payload,
    gen_random_uuid()::text, public.member_v2_fingerprint('create_member_v2',v_owner,'November_2025',v_trusted,null,v_payload));
  perform set_config('datser.member_v2.skip_capture', 'off', true);
  v_result := jsonb_build_object('trustedCreateDeleted',
    (select is_deleted from public.member_v2_heads where owner_id=v_owner and table_name='November_2025' and member_id=v_trusted));

  insert into public."November_2025" (id,user_id,workspace_owner_id,"Full Name")
    values (v_ordinary,v_owner,v_owner,'Synthetic ordinary create');
  v_result := v_result || jsonb_build_object('ordinaryCreateDeleted',
    (select is_deleted from public.member_v2_heads where owner_id=v_owner and table_name='November_2025' and member_id=v_ordinary));
  update public."November_2025" set "Full Name"='Synthetic ordinary update one' where id=v_ordinary and workspace_owner_id=v_owner;
  update public."November_2025" set "Full Name"='Synthetic ordinary update two' where id=v_ordinary and workspace_owner_id=v_owner;
  v_result := v_result || jsonb_build_object('ordinaryUpdates',
    (select jsonb_agg(jsonb_build_object('deleted',is_deleted,'operation',operation_name) order by server_revision)
      from public.member_v2_change_events where owner_id=v_owner and table_name='November_2025' and member_id=v_ordinary and operation_name='update'));

  insert into public."January_2025" (id,user_id,workspace_owner_id,"Full Name")
    values (v_trusted,v_owner,v_owner,'Synthetic historical member');
  v_delete := public.delete_member_v2('November_2025',v_owner,v_trusted,(v_create->>'server_revision')::bigint,v_request,
    public.member_v2_fingerprint('delete_member_v2',v_owner,'November_2025',v_trusted,(v_create->>'server_revision')::bigint,'{}'::jsonb));
  perform set_config('datser.member_v2.skip_capture', 'off', true);
  v_result := v_result || jsonb_build_object(
    'deleteStatus',v_delete->>'status',
    'deleteEvents',(select jsonb_agg(jsonb_build_object('deleted',is_deleted,'operation',operation_name))
      from public.member_v2_change_events where owner_id=v_owner and table_name='November_2025' and member_id=v_trusted and server_revision>(v_create->>'server_revision')::bigint),
    'rowSoftDeleted',(select deleted_at is not null from public."November_2025" where id=v_trusted and workspace_owner_id=v_owner),
    'historyPreserved',(select count(*)=1 from public."January_2025" where id=v_trusted and workspace_owner_id=v_owner and deleted_at is null));

  perform set_config('datser.member_v2.skip_capture','on',true);
  insert into public."November_2025" (id,user_id,workspace_owner_id,"Full Name",deleted_at) values
    (v_active,v_owner,v_owner,'Synthetic bootstrap active',null),
    (v_deleted,v_owner,v_owner,'Synthetic bootstrap deleted',clock_timestamp());
  perform set_config('datser.member_v2.skip_capture','off',true);
  perform public.pull_workspace_member_changes_v2(v_owner,null,100);
  v_result := v_result || jsonb_build_object(
    'bootstrapActiveDeleted',(select is_deleted from public.member_v2_heads where owner_id=v_owner and table_name='November_2025' and member_id=v_active),
    'bootstrapDeletedDeleted',(select is_deleted from public.member_v2_heads where owner_id=v_owner and table_name='November_2025' and member_id=v_deleted),
    'bootstrapOperations',(select jsonb_agg(operation_name) from public.member_v2_change_events where owner_id=v_owner and member_id in (v_active,v_deleted)));
  insert into tombstone_results values(v_result);
end $proof$;
select result::text from tombstone_results;
rollback;
`
  const output = execFileSync(docker, ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql, encoding: 'utf8' })
  results = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{"') && line.includes('ordinaryUpdates')))
}, 30000)

afterAll(async () => { if (ownerId) await admin.auth.admin.deleteUser(ownerId) })

describe('Member V2 tombstone semantics on local Supabase', () => {
  it('keeps a trusted create active', () => expect(results.trustedCreateDeleted).toBe(false))
  it('captures an ordinary active create without a tombstone', () => expect(results.ordinaryCreateDeleted).toBe(false))
  it('keeps an ordinary profile update active', () => expect(results.ordinaryUpdates[0]).toEqual({ deleted: false, operation: 'update' }))
  it('captures every repeated ordinary profile update as active', () => expect(results.ordinaryUpdates).toEqual([{ deleted: false, operation: 'update' }, { deleted: false, operation: 'update' }]))
  it('composes trusted soft delete with trigger suppression and preserves history', () => {
    expect(results.deleteStatus).toBe('SUCCESS')
    expect(results.deleteEvents).toEqual([{ deleted: true, operation: 'delete_member_v2' }])
    expect(results.rowSoftDeleted).toBe(true)
    expect(results.historyPreserved).toBe(true)
  })
  it('bootstraps an existing active row as active through the actual initial pull', () => expect(results.bootstrapActiveDeleted).toBe(false))
  it('bootstraps a retained soft-deleted row as a tombstone', () => {
    expect(results.bootstrapDeletedDeleted).toBe(true)
    expect(results.bootstrapOperations).toEqual(['bootstrap', 'bootstrap'])
  })
})
