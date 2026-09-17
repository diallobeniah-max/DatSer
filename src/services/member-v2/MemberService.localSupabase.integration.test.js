// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { readLocalSupabase } from '../../experiments/rxdb-backend-poc/testing/localSupabaseFixture'
import { createMemberV2Fingerprint } from '../../experiments/rxdb-member-phase1/memberContractFingerprint'
import { createMemberService } from './MemberService'
import { createMemberAttendanceService } from './MemberAttendanceService'
import { MEMBER_SAVE_STATES } from './memberSaveState'
import { createMemberV2NetworkController } from '../../experiments/rxdb-member-phase1/NetworkController'

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
  it('recovers an authenticated realistic local create after the harness selected an unregistered source month', async () => {
    let online = false
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await service.start()
    const local = await service.createMember({ tableName: 'January_2025', member: { full_name: 'Recovered authenticated member', phone_number: '0240000000', age: '12', gender: 'Male', current_level: 'JHS3', notes: 'Synthetic recovery test' } })
    const request = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].toJSON()
    online = true; await service.syncNow()
    expect((await service.getMember(local.id)).save_state).toBe(MEMBER_SAVE_STATES.FAILED_RETRYABLE)
    expect((await service.getMember(local.id)).last_error).toBe('This logical month is not registered for the workspace')
    expect((await service.listTrustedSourceTables()).map((month) => month.table_name)).toContain(fixture.tableName)

    const recovered = await service.recoverUnregisteredTargetCreates({ tableName: fixture.tableName })
    expect(recovered).toEqual({ recovered: 1, requestIds: [request.id] })
    await service.syncNow()
    const confirmed = await service.getMember(local.id)
    expect(confirmed).toMatchObject({ member_id: local.id, table_name: fixture.tableName, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    expect(confirmed.data.member_code).toBeTruthy()
    expect(await service.awaitServerConfirmation(request.id)).toMatchObject({ state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    const serverRow = await fixture.client.from(fixture.tableName).select('id').eq('id', local.id)
    expect(serverRow.error).toBeNull(); expect(serverRow.data).toHaveLength(1)
    await service.stop()
  }, 30000)

  it('uses authenticated source capabilities to recover a realistic profile without duplicate server rows', async () => {
    let online = false
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await service.start()
    const capabilities = await service.getSourceTableCapabilities(fixture.tableName)
    expect(capabilities.fields).toEqual(expect.any(Set)); expect(capabilities.fields.has('Full Name')).toBe(true); expect(capabilities.fields.has('date_of_birth')).toBe(false)
    const local = await service.createMember({ tableName: fixture.tableName, member: { full_name: 'Compatible server profile', phone_number: '0240000000', age: '15', gender: 'Female', current_level: 'SHS1', parent_name_1: 'Synthetic parent', notes: 'Synthetic note', date_of_birth: '2011-01-01' } })
    const request = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].toJSON()
    online = true; await service.syncNow()
    expect((await service.getMember(local.id)).last_error).toBe('Unsupported member field')
    const repaired = await service.recoverUnsupportedFieldCreates({ fields: capabilities.fields })
    expect(repaired).toMatchObject({ recovered: 1, requestIds: [request.id], removedFields: ['date_of_birth'] })
    await service.syncNow()
    const confirmed = await service.getMember(local.id)
    expect(confirmed).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, table_name: fixture.tableName })
    expect(confirmed.data).toMatchObject({ 'Full Name': 'Compatible server profile', 'Phone Number': 240000000, Age: 15, Gender: 'Female', 'Current Level': 'SHS1', parent_name_1: 'Synthetic parent', notes: 'Synthetic note' })
    expect(confirmed.data.member_code).toBeTruthy(); expect(confirmed.data.date_of_birth).toBeUndefined()
    const serverRow = await fixture.client.from(fixture.tableName).select('id').eq('id', local.id)
    expect(serverRow.error).toBeNull(); expect(serverRow.data).toHaveLength(1)
    await service.stop()
  }, 30000)

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

    const originalCode = confirmed.data.member_code
    await reopened.updateMember(local.id, { full_name: 'Edited full profile', phone_number: '0555000000', age: '19', gender: 'Female', current_level: 'Completed SHS' })
    await reopened.syncNow()
    const edited = await reopened.getMember(local.id)
    expect(edited).toMatchObject({ id: local.id, member_id: local.id, table_name: fixture.tableName, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    expect(edited.data).toMatchObject({ 'Full Name': 'Edited full profile', 'Phone Number': 555000000, Age: 19, Gender: 'Female', 'Current Level': 'Completed SHS', member_code: originalCode })

    online = false; await reopened.updateMember(local.id, { full_name: 'Local offline edit' })
    const remotePayload = { 'Full Name': 'Remote concurrent edit' }
    const fingerprint = await createMemberV2Fingerprint({ operation: 'update_member_v2', ownerId: fixture.userId, tableName: fixture.tableName, memberId: local.id, baseServerRevision: edited.server_revision, payload: remotePayload })
    const remote = await fixture.client.rpc('update_member_v2', { p_table_name: fixture.tableName, p_owner_id: fixture.userId, p_member_id: local.id, p_updates: remotePayload, p_base_server_revision: edited.server_revision, p_request_id: crypto.randomUUID(), p_payload_fingerprint: fingerprint, p_identity: {} })
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

  it('persists isolated Sunday attendance offline, then confirms it through the trusted local RPC', async () => {
    let online = false
    const memberService = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await memberService.start()
    const member = await memberService.createMember({ tableName: fixture.tableName, member: { full_name: 'Attendance synthetic member', phone_number: '0240000000', age: '18', gender: 'Female', current_level: 'SHS3' } })
    online = true; await memberService.syncNow()
    const confirmed = await memberService.getMember(member.id)
    expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)

    online = false
    const attendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await attendance.start()
    await attendance.saveAttendance({ memberId: confirmed.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status: 'Present' })
    await attendance.saveAttendance({ memberId: confirmed.id, tableName: fixture.tableName, attendanceDate: '2025-12-14', status: 'Absent' })
    expect(await attendance.getForMember(confirmed.id)).toHaveLength(2)
    await attendance.stop()

    const reopened = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await reopened.start()
    expect((await reopened.getForMember(confirmed.id)).map((row) => row.status)).toEqual(['Present', 'Absent'])
    online = true; await reopened.syncNow()
    expect((await reopened.getSyncState()).state).toBe('SYNCED')
    await reopened.saveAttendance({ memberId: confirmed.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status: null })
    await reopened.syncNow()
    expect((await reopened.getForMember(confirmed.id)).map((row) => row.status)).toEqual(['Absent'])
    await reopened.stop(); await memberService.stop()
  }, 30000)

  it('propagates confirmed profile and isolated attendance to a second local client', async () => {
    const firstStorage = getRxStorageMemory(); const secondStorage = getRxStorageMemory()
    const first = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, online: () => true })
    await first.start(); const created = await first.createMember({ tableName: fixture.tableName, member: { full_name: 'Second client synthetic member', gender: 'Male', current_level: 'JHS3' } }); await first.syncNow()
    const firstAttendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, online: () => true })
    await firstAttendance.start(); await firstAttendance.saveAttendance({ memberId: created.id, tableName: fixture.tableName, attendanceDate: '2025-12-21', status: 'Present' }); await firstAttendance.syncNow()
    await Promise.all([first.stop(), firstAttendance.stop()])
    const second = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: secondStorage, online: () => true })
    await second.start(); await second.pull()
    expect((await second.getMember(created.id)).data['Full Name']).toBe('Second client synthetic member')

    const secondAttendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: secondStorage, online: () => true })
    await secondAttendance.start(); await secondAttendance.pull()
    expect((await secondAttendance.getForMember(created.id))[0]).toMatchObject({ attendance_date: '2025-12-21', status: 'Present' })
    await Promise.all([second.stop(), secondAttendance.stop()])
  }, 30000)

  it('keeps simulated-offline member and attendance work off the local server until reconnect, then confirms without duplicates', async () => {
    const controllerStorage = new Map(); const connectivity = createMemberV2NetworkController({ storage: { getItem: (key) => controllerStorage.get(key) || null, setItem: (key, value) => controllerStorage.set(key, value), removeItem: (key) => controllerStorage.delete(key) }, browserOnlineCheck: () => true })
    const firstStorage = getRxStorageMemory()
    const first = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); await first.start()
    const created = await first.createMember({ tableName: fixture.tableName, member: { full_name: 'Offline boundary original', current_level: 'JHS2' } }); await first.syncNow(); await first.syncNow()
    const confirmed = await first.getMember(created.id); expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    const firstAttendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); await firstAttendance.start(); await new Promise((resolve) => setTimeout(resolve, 25))
    connectivity.setSimulatedOffline(true)
    const updated = await first.updateMember(created.id, { full_name: 'Offline boundary local edit' }); const attendanceSave = await firstAttendance.saveAttendance({ memberId: created.id, tableName: fixture.tableName, attendanceDate: '2025-12-28', status: 'Present' })
    expect(updated.save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING); expect((await firstAttendance.getForMember(created.id))[0].save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING)

    await Promise.all([first.stop(), firstAttendance.stop()])
    const serverBefore = await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: fixture.userId, p_after_server_revision: 0, p_limit: 100 }); expect(serverBefore.error).toBeNull(); expect(serverBefore.data.changes.find((change) => change.member_id === created.id).member['Full Name']).toBe('Offline boundary original')

    const firstReopened = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); const attendanceReopened = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); await Promise.all([firstReopened.start(), attendanceReopened.start()]); const memberMutation = (await firstReopened.database.mutations.find({ selector: { member_id: created.id } }).exec())[0].toJSON(); connectivity.setSimulatedOffline(false); await Promise.all([firstReopened.syncNow(), attendanceReopened.syncNow()]); await Promise.all([firstReopened.syncNow(), attendanceReopened.syncNow()])
    const firstConfirmed = await firstReopened.getMember(created.id); expect(firstConfirmed).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, data: { 'Full Name': 'Offline boundary local edit' } }); expect((await attendanceReopened.getForMember(created.id))[0].save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED); await Promise.all([firstReopened.stop(), attendanceReopened.stop()])
    const row = await fixture.client.from(fixture.tableName).select('id').eq('id', created.id); expect(row.data).toHaveLength(1)
    expect(memberMutation.id).toMatch(/^update_member_v2:/); expect(attendanceSave.requestId).toMatch(/^member_v2_attendance:/)
  }, 30000)
})
