// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { readLocalSupabase } from '../../experiments/rxdb-backend-poc/testing/localSupabaseFixture'
import { createMemberV2Fingerprint } from '../../experiments/rxdb-member-phase1/memberContractFingerprint'
import { createMemberService } from './MemberService'
import { MEMBER_SAVE_STATES } from './memberSaveState'

const fixture = {}; const storage = getRxStorageMemory()

beforeAll(async () => {
  const config = readLocalSupabase(); fixture.admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `member-v2-client-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@local.invalid`; const password = `MemberV2-${crypto.randomUUID()}-9a!`
  const created = await fixture.admin.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error) throw created.error
  fixture.userId = created.data.user.id; fixture.client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await fixture.client.auth.signInWithPassword({ email, password }); if (login.error) throw login.error
  await fixture.client.realtime.setAuth(login.data.session.access_token)
  const month = await fixture.client.rpc('create_workspace_month', { p_owner_id: fixture.userId, p_year: 2025, p_month: 12, p_source_month: null, p_copy_mode: 'empty', p_member_ids: [] })
  if (month.error) throw month.error; fixture.tableName = month.data.table_name
}, 30000)

afterAll(async () => { if (fixture.userId) await fixture.admin.auth.admin.deleteUser(fixture.userId) })

describe.sequential('Member V2 service with local authenticated Supabase', () => {
  it('persists offline work, confirms the same request, and retains a real server conflict', async () => {
    let online = false
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await service.start()
    const local = await service.createMember({ tableName: fixture.tableName, member: { full_name: 'Offline synthetic member', phone_number: '0240000000' } })
    const request = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].id
    expect((await service.getMember(local.id)).save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING)
    await service.stop()

    const reopened = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await reopened.start()
    expect((await reopened.getMember(local.id)).data['Full Name']).toBe('Offline synthetic member')
    online = true; await reopened.syncNow()
    const confirmed = await reopened.getMember(local.id)
    expect(confirmed.last_error).toBeNull()
    expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    expect(confirmed.data.member_code).toBeTruthy()
    expect(await reopened.awaitServerConfirmation(request)).toMatchObject({ state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })

    online = false; await reopened.updateMember(local.id, { full_name: 'Local offline edit' })
    const remotePayload = { 'Full Name': 'Remote concurrent edit' }
    const fingerprint = await createMemberV2Fingerprint({ operation: 'update_member_v2', ownerId: fixture.userId, tableName: fixture.tableName, memberId: local.id, baseServerRevision: confirmed.server_revision, payload: remotePayload })
    const remote = await fixture.client.rpc('update_member_v2', { p_table_name: fixture.tableName, p_owner_id: fixture.userId, p_member_id: local.id, p_updates: remotePayload, p_base_server_revision: confirmed.server_revision, p_request_id: crypto.randomUUID(), p_payload_fingerprint: fingerprint, p_identity: {} })
    expect(remote.error).toBeNull()
    const signals = await fixture.client.from('member_v2_realtime_signals').select('latest_server_revision').eq('owner_id', fixture.userId)
    expect(signals.error).toBeNull()
    expect(signals.data.some((signal) => signal.latest_server_revision === remote.data.server_revision)).toBe(true)
    online = true; await reopened.syncNow()
    const conflict = await reopened.getMember(local.id)
    expect(conflict.save_state).toBe(MEMBER_SAVE_STATES.CONFLICT)
    expect(conflict.data['Full Name']).toBe('Local offline edit')
    await reopened.stop()
  }, 30000)
})
