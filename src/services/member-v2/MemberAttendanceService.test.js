import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { createMemberAttendanceService } from './MemberAttendanceService'
import { createMemberV2AttendanceDatabase } from '../../data/member-v2/rxdb/createMemberV2AttendanceDatabase'
import { MEMBER_SAVE_STATES } from './memberSaveState'
import { createMemberV2NetworkController } from '../../experiments/rxdb-member-phase1/NetworkController'
import { createMemberV2AttendanceFingerprint } from '../../experiments/rxdb-member-phase1/attendanceContractFingerprint'

const tableName = 'December_2025'
const services = []
const rpcClient = (handler) => ({ rpc: handler, removeChannel: async () => {}, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }) })
const makeService = async ({ rpc, online = () => false, connectivity = null, canPushMutation = null } = {}) => {
  const service = await createMemberAttendanceService({ supabase: rpcClient(rpc), userId: crypto.randomUUID(), ownerId: crypto.randomUUID(), storage: getRxStorageMemory(), online, connectivity, canPushMutation })
  services.push(service); await service.start(); return service
}
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.stop())) })

describe('Member V2 isolated attendance service', () => {
  it('keeps one canonical local record per member and Sunday while offline', async () => {
    const service = await makeService({ rpc: async () => { throw new Error('network unavailable') } }); const memberId = crypto.randomUUID()
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: 'Present' })
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: 'Absent' })
    expect(await service.getForMember(memberId)).toHaveLength(1)
    expect((await service.getForMember(memberId))[0]).toMatchObject({ status: 'Absent', save_state: MEMBER_SAVE_STATES.LOCAL_PENDING })
    expect((await service.getSyncState()).pendingChanges).toBe(2)
  })

  it('recovers an attendance intent after interruption before its RxDB projection', async () => {
    let online = false; const calls = []; const userId = crypto.randomUUID(); const ownerId = crypto.randomUUID(); const memberId = crypto.randomUUID()
    let database = await createMemberV2AttendanceDatabase({ userId, ownerId, storage: getRxStorageDexie() })
    const options = { database, userId, ownerId, online: () => online, supabase: rpcClient(async (name, args) => { calls.push(name); if (name === 'save_member_v2_attendance') return { data: { status: 'SUCCESS', server_revision: 1, attendance: { attendance_id: args.p_attendance_id, attendance_date: args.p_attendance_date, status: args.p_attendance_status, is_deleted: false, table_name: args.p_table_name } }, error: null }; return { data: { changes: [], next_cursor: 1, has_more: false }, error: null } }) }
    const first = await createMemberAttendanceService(options); services.push(first); await first.start()
    const insert = database.attendance.insert.bind(database.attendance); database.attendance.insert = async (...args) => { database.attendance.insert = insert; throw new Error('simulated process interruption') }
    await expect(first.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: 'Present' })).rejects.toThrow('simulated process interruption')
    const journal = (await database.mutations.find().exec())[0].toJSON(); expect(journal.save_state).toBe(MEMBER_SAVE_STATES.PREPARED)
    await first.stop()
    await database.close(); database = await createMemberV2AttendanceDatabase({ userId, ownerId, storage: getRxStorageDexie() }); options.database = database
    const restarted = await createMemberAttendanceService(options); services.push(restarted); await restarted.start()
    expect(await restarted.getForMember(memberId)).toMatchObject([{ status: 'Present', save_state: MEMBER_SAVE_STATES.LOCAL_PENDING }])
    online = true; await restarted.syncNow()
    expect(calls.filter((name) => name === 'save_member_v2_attendance')).toHaveLength(1)
    expect((await restarted.getForMember(memberId))[0].save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    await database.close()
  })

  it('keeps attendance LOCAL_PENDING and makes zero backend calls during simulated offline', async () => {
    const storage = new Map(); const connectivity = createMemberV2NetworkController({ storage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } }); connectivity.setSimulatedOffline(true)
    const calls = []; const service = await makeService({ connectivity, rpc: async (name) => { calls.push(name); return { data: { changes: [], has_more: false }, error: null } } }); const memberId = crypto.randomUUID()
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: 'Present' }); await service.syncNow()
    expect(calls).toEqual([]); expect((await service.getForMember(memberId))[0].save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING); expect(await service.getSyncState()).toMatchObject({ state: 'OFFLINE_PENDING', pendingChanges: 1 })
  })

  it('automatically retries the same attendance request after simulated offline ends', async () => {
    const storage = new Map(); const connectivity = createMemberV2NetworkController({ storage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } }); connectivity.setSimulatedOffline(true)
    const requests = []; const service = await makeService({ connectivity, rpc: async (name, args) => { if (name === 'pull_member_v2_attendance_changes_v2') return { data: { changes: [], next_cursor: 1, has_more: false }, error: null }; requests.push(args.p_request_id); return { data: { status: 'SUCCESS', server_revision: 1, attendance: { attendance_id: args.p_attendance_id, attendance_date: args.p_attendance_date, status: args.p_attendance_status, is_deleted: false, table_name: args.p_table_name } }, error: null } } }); const memberId = crypto.randomUUID()
    const result = await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: 'Present' }); connectivity.setSimulatedOffline(false); await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requests).toEqual([result.requestId]); expect((await service.getForMember(memberId))[0].save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
  })

  it('uses a durable request across retries and confirms Present, Absent, and Clear', async () => {
    let online = false; let attempts = 0; const requestIds = []; const memberId = crypto.randomUUID()
    const service = await makeService({ online: () => online, rpc: async (name, args) => {
      if (name === 'pull_member_v2_attendance_changes_v2') return { data: { changes: [], next_cursor: 1, has_more: false }, error: null }
      requestIds.push(args.p_request_id); attempts += 1
      if (attempts === 1) return { data: null, error: new Error('offline') }
      return { data: { status: 'SUCCESS', server_revision: attempts, attendance: { attendance_id: args.p_attendance_id, attendance_date: args.p_attendance_date, status: args.p_attendance_status, is_deleted: args.p_attendance_status === null, table_name: args.p_table_name } }, error: null }
    } })
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: 'Present' }); online = true; await service.syncNow(); await service.syncNow()
    expect(requestIds[0]).toBe(requestIds[1]); expect((await service.getForMember(memberId))[0].status).toBe('Present')
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: 'Absent' }); await service.syncNow(); expect((await service.getForMember(memberId))[0].status).toBe('Absent')
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-07', status: null }); await service.syncNow(); expect(await service.getForMember(memberId)).toHaveLength(0)
    expect((await service.getSyncState()).state).toBe('SYNCED')
  })

  it('does not report SYNCED while an attendance mutation has a retryable failure', async () => {
    let online = false; const memberId = crypto.randomUUID(); const service = await makeService({ online: () => online, rpc: async (name) => name === 'pull_member_v2_attendance_changes_v2' ? { data: { changes: [], next_cursor: null, has_more: false }, error: null } : { data: null, error: new Error('temporary failure') } })
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-14', status: 'Present' }); online = true; await service.syncNow()
    expect((await service.getSyncState()).state).toBe(MEMBER_SAVE_STATES.FAILED_RETRYABLE)
  })

  it('rebases rapid local changes for one Sunday with a matching fingerprint and without duplicating its logical row', async () => {
    let online = false; let revision = 0; const memberId = crypto.randomUUID(); const requestRevisions = []
    const service = await makeService({ online: () => online, rpc: async (name, args) => {
      if (name === 'pull_member_v2_attendance_changes_v2') return { data: { changes: [], next_cursor: revision, has_more: false }, error: null }
      const operation = args.p_attendance_status === null ? 'clear_member_v2_attendance' : 'set_member_v2_attendance'
      const expectedFingerprint = await createMemberV2AttendanceFingerprint({ operation, ownerId: service.ownerId, memberId: args.p_member_id, tableName: args.p_table_name, attendanceDate: args.p_attendance_date, status: args.p_attendance_status, baseServerRevision: args.p_base_server_revision })
      requestRevisions.push(args.p_base_server_revision)
      if (args.p_payload_fingerprint !== expectedFingerprint) return { data: null, error: new Error('Attendance payload fingerprint does not match') }
      if (args.p_base_server_revision !== (revision || null)) return { data: { status: 'CONFLICT', server_revision: revision }, error: null }
      revision += 1; return { data: { status: 'SUCCESS', server_revision: revision, attendance: { attendance_id: args.p_attendance_id, attendance_date: args.p_attendance_date, status: args.p_attendance_status, is_deleted: args.p_attendance_status === null, table_name: args.p_table_name } }, error: null }
    } })
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-21', status: 'Present' })
    await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-21', status: 'Absent' })
    online = true; await service.syncNow(); await service.syncNow()
    expect(await service.getForMember(memberId)).toHaveLength(1)
    expect((await service.getForMember(memberId))[0].status).toBe('Absent')
    expect((await service.getSyncState()).state).toBe('SYNCED')
    expect(requestRevisions).toEqual([null, 1])
  })

  it('holds attendance for an unconfirmed local member until its dependent profile is confirmed', async () => {
    let confirmed = false; const calls = []; const memberId = crypto.randomUUID()
    const service = await makeService({
      online: () => true,
      canPushMutation: async () => confirmed,
      rpc: async (name, args) => {
        calls.push(name)
        if (name === 'pull_member_v2_attendance_changes_v2') return { data: { changes: [], next_cursor: 1, has_more: false }, error: null }
        return { data: { status: 'SUCCESS', server_revision: 1, attendance: { attendance_id: args.p_attendance_id, attendance_date: args.p_attendance_date, status: args.p_attendance_status, is_deleted: false, table_name: args.p_table_name } }, error: null }
      },
    })
    const pending = await service.saveAttendance({ memberId, tableName, attendanceDate: '2025-12-28', status: 'Present' })
    await service.syncNow()
    expect(calls).not.toContain('save_member_v2_attendance')
    expect((await service.getSyncState()).pendingChanges).toBe(1)

    confirmed = true
    await service.syncNow()
    expect(calls.filter((name) => name === 'save_member_v2_attendance')).toEqual(['save_member_v2_attendance'])
    expect((await service.getForMember(memberId))[0]).toMatchObject({ status: 'Present', save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    expect(pending.requestId).toMatch(/^member_v2_attendance:/)
  })

  it('accepts only realtime wake signals for its own owner before pulling', async () => {
    let onChange
    let subscription
    let pulls = 0
    const supabase = {
      rpc: async (name) => {
        if (name === 'pull_member_v2_attendance_changes_v2') pulls += 1
        return { data: { changes: [], next_cursor: pulls, has_more: false }, error: null }
      },
      channel: () => ({ on: (event, filter, callback) => { subscription = { event, filter }; onChange = callback; return { subscribe: () => ({}) } } }),
      removeChannel: async () => {},
    }
    const service = await createMemberAttendanceService({ supabase, userId: crypto.randomUUID(), ownerId: crypto.randomUUID(), storage: getRxStorageMemory(), online: () => true, realtimeDebounceMs: 1 })
    services.push(service)
    await service.start()
    expect(subscription).toEqual({
      event: 'postgres_changes',
      filter: { event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals' },
    })
    await service.syncNow()
    const before = pulls
    onChange({ new: { owner_id: crypto.randomUUID(), latest_server_revision: 99 } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pulls).toBe(before)
    onChange({ new: { owner_id: service.ownerId, latest_server_revision: 100 } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pulls).toBe(before + 1)
  })
})
