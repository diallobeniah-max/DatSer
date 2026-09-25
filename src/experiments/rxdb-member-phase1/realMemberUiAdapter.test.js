import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRealMemberV2UiAdapter, resetRealMemberV2UiAdapterForTests, wakeRealMemberV2Sync } from './realMemberUiAdapter'
import { RealDatserConnectionController, resetRealDatserMemberV2ConnectivityForTests } from './realDatserConnectivity'

const ids = {
  userId: '11111111-1111-4111-8111-111111111111',
  ownerId: '22222222-2222-4222-8222-222222222222',
  memberId: '33333333-3333-4333-8333-333333333333',
}
const tableName = 'January_2026'

const client = (handler) => ({
  rpc: handler,
  removeChannel: async () => {},
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
})

afterEach(async () => {
  await resetRealMemberV2UiAdapterForTests()
  resetRealDatserMemberV2ConnectivityForTests()
})

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

describe('real member-form Member V2 adapter', () => {
  it('uses only the Member V2 create RPC and returns a canonical UI record', async () => {
    const calls = []
    const adapter = await getRealMemberV2UiAdapter({
      ...ids,
      online: () => true,
      supabase: client(async (name, args) => {
        calls.push({ name, args })
        if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [], next_cursor: null, has_more: false }, error: null }
        return {
          data: {
            status: 'SUCCESS',
            server_revision: 4,
            table_name: tableName,
            member: { id: args.p_member_id, 'Full Name': args.p_member['Full Name'], member_code: 'M0100' },
          },
          error: null,
        }
      }),
    })

    const result = await adapter.create({ tableName, payload: { 'Full Name': 'Local bridge create' } })

    expect(calls.map((call) => call.name)).toContain('create_member_v2')
    expect(calls.map((call) => call.name)).not.toContain('save_member_bundle_resilient')
    expect(result.member).toMatchObject({
      'Full Name': 'Local bridge create',
      member_code: 'M0100',
      __source_table: tableName,
      __member_v2_save_state: 'SERVER_CONFIRMED',
    })
    expect(result.syncState.pendingChanges).toBe(0)
  })

  it('uses the bootstrapped revision and canonical source identity for an edit', async () => {
    const calls = []
    let firstPull = true
    const adapter = await getRealMemberV2UiAdapter({
      ...ids,
      online: () => true,
      supabase: client(async (name, args) => {
        calls.push({ name, args })
        if (name === 'pull_workspace_member_changes_v2') {
          if (!firstPull) return { data: { changes: [], next_cursor: 8, has_more: false }, error: null }
          firstPull = false
          return {
            data: {
              changes: [{
                server_revision: 7,
                table_name: tableName,
                member_id: ids.memberId,
                is_deleted: false,
                member: { id: ids.memberId, 'Full Name': 'Before edit', member_code: 'M0101' },
                changed_at: '2026-01-01T00:00:00.000Z',
              }],
              next_cursor: 7,
              has_more: false,
            },
            error: null,
          }
        }
        return {
          data: {
            status: 'SUCCESS',
            server_revision: 8,
            table_name: tableName,
            member: { id: ids.memberId, 'Full Name': 'After edit', member_code: 'M0101' },
          },
          error: null,
        }
      }),
    })

    const result = await adapter.update({
      tableName,
      member: { id: ids.memberId, __canonical_member_id: ids.memberId, __source_table: tableName },
      updates: { full_name: 'After edit' },
    })
    const update = calls.find((call) => call.name === 'update_member_v2')
    expect(update.args.p_table_name).toBe(tableName)
    expect(update.args.p_member_id).toBe(ids.memberId)
    expect(update.args.p_base_server_revision).toBe(7)
    expect(update.args.p_identity).toMatchObject({ canonical_member_id: ids.memberId, source_table: tableName })
    expect(result.member).toMatchObject({ 'Full Name': 'After edit', server_revision: 8 })
  })

  it('keeps the real UI edit local while DatSer is forced offline, then flushes that same request after reconnect', async () => {
    const calls = []
    const connectivity = new RealDatserConnectionController()
    let firstPull = true
    const adapter = await getRealMemberV2UiAdapter({
      ...ids,
      connectivity,
      supabase: client(async (name, args) => {
        calls.push({ name, args })
        if (name === 'pull_workspace_member_changes_v2') {
          if (!firstPull) return { data: { changes: [], next_cursor: 7, has_more: false }, error: null }
          firstPull = false
          return { data: { changes: [{ server_revision: 7, table_name: tableName, member_id: ids.memberId, is_deleted: false, member: { id: ids.memberId, 'Full Name': 'Before edit', member_code: 'M0101' }, changed_at: '2026-01-01T00:00:00.000Z' }], next_cursor: 7, has_more: false }, error: null }
        }
        return { data: { status: 'SUCCESS', server_revision: 8, table_name: tableName, member: { id: ids.memberId, 'Full Name': 'After reconnect', member_code: 'M0101' } }, error: null }
      }),
    })

    connectivity.setConnection({ isOnline: true, offlineMode: 'offline', offlineModeStatus: 'forced-offline' })
    const local = await adapter.update({ tableName, member: { id: ids.memberId, __canonical_member_id: ids.memberId }, updates: { full_name: 'Local offline edit' } })
    expect(local.syncState).toMatchObject({ state: 'OFFLINE_PENDING', pendingChanges: 1 })
    expect(calls.map((call) => call.name)).not.toContain('update_member_v2')

    connectivity.setConnection({ isOnline: true, offlineMode: 'online', offlineModeStatus: 'online' })
    await wakeRealMemberV2Sync()
    await vi.waitFor(() => expect(calls.find((call) => call.name === 'update_member_v2')).toBeTruthy())
    const updates = calls.filter((call) => call.name === 'update_member_v2')
    const update = updates[0]
    expect(update.args.p_request_id).toMatch(/^update_member_v2:/)
    expect(updates).toHaveLength(1)
    expect((await adapter.refreshGuard()).pendingChanges).toBe(0)
  })

  it('routes deletion through the Member V2 delete RPC and leaves no local attendance replay', async () => {
    const calls = []; let deleted = false
    const adapter = await getRealMemberV2UiAdapter({
      ...ids,
      online: () => true,
      supabase: client(async (name, args) => {
        calls.push({ name, args })
        if (name === 'pull_workspace_member_changes_v2') {
          return { data: { changes: [{ server_revision: deleted ? 8 : 7, table_name: tableName, member_id: ids.memberId, is_deleted: deleted, member: { id: ids.memberId, 'Full Name': 'Delete me', member_code: 'M0101' }, changed_at: '2026-01-01T00:00:00.000Z' }], next_cursor: deleted ? 8 : 7, has_more: false }, error: null }
        }
        if (name === 'pull_member_v2_attendance_changes_v2') return { data: { changes: [], next_cursor: 0, has_more: false }, error: null }
        if (name === 'delete_member_v2') {
          deleted = true
          return { data: { status: 'SUCCESS', server_revision: 8, table_name: tableName, member: { id: ids.memberId, 'Full Name': 'Delete me', member_code: 'M0101', deleted_at: '2026-01-02T00:00:00.000Z' } }, error: null }
        }
        throw new Error(`Unexpected RPC ${name}`)
      }),
    })

    const result = await adapter.deleteMember({ tableName, member: { id: ids.memberId, __canonical_member_id: ids.memberId, __source_table: tableName } })
    const deletion = calls.find((call) => call.name === 'delete_member_v2')
    expect(deletion.args).toMatchObject({ p_table_name: tableName, p_member_id: ids.memberId, p_base_server_revision: 7 })
    expect(calls.map((call) => call.name)).not.toContain('soft_delete_member')
    expect(result.member).toBeNull()
    expect(result.syncState.pendingChanges).toBe(0)
  })

  it('queues selected attendance behind Member V2 creation and never uses a legacy attendance RPC', async () => {
    const calls = []
    const adapter = await getRealMemberV2UiAdapter({
      ...ids,
      online: () => true,
      supabase: client(async (name, args) => {
        calls.push({ name, args })
        if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [], next_cursor: 1, has_more: false }, error: null }
        if (name === 'pull_member_v2_attendance_changes_v2') return { data: { changes: [], next_cursor: 1, has_more: false }, error: null }
        if (name === 'create_member_v2') return { data: { status: 'SUCCESS', server_revision: 4, table_name: tableName, member: { id: args.p_member_id, 'Full Name': args.p_member['Full Name'], member_code: 'M0102' } }, error: null }
        if (name === 'save_member_v2_attendance') return { data: { status: 'SUCCESS', server_revision: 5, attendance: { attendance_id: args.p_attendance_id, attendance_date: args.p_attendance_date, status: args.p_attendance_status, is_deleted: false, table_name: args.p_table_name } }, error: null }
        throw new Error(`Unexpected RPC ${name}`)
      }),
    })

    const result = await adapter.create({ tableName, payload: { 'Full Name': 'Attendance after create' }, attendance: { '2026-01-04': true } })
    const rpcNames = calls.map((call) => call.name)
    expect(rpcNames.indexOf('create_member_v2')).toBeLessThan(rpcNames.indexOf('save_member_v2_attendance'))
    expect(rpcNames).not.toContain('set_workspace_month_member_attendance')
    expect(rpcNames).not.toContain('update_member_bundle_resilient')
    expect(result.syncState).toMatchObject({ pendingChanges: 0 })
  })

  it('exports pending queue evidence without profile fields or mutation payloads', async () => {
    const connectivity = new RealDatserConnectionController(); let firstPull = true
    const adapter = await getRealMemberV2UiAdapter({
      ...ids,
      connectivity,
      supabase: client(async (name) => {
        if (name === 'pull_workspace_member_changes_v2') {
          if (!firstPull) return { data: { changes: [], next_cursor: 7, has_more: false }, error: null }
          firstPull = false
          return { data: { changes: [{ server_revision: 7, table_name: tableName, member_id: ids.memberId, is_deleted: false, member: { id: ids.memberId, 'Full Name': 'Server name', member_code: 'M0103' }, changed_at: '2026-01-01T00:00:00.000Z' }], next_cursor: 7, has_more: false }, error: null }
        }
        if (name === 'pull_member_v2_attendance_changes_v2') return { data: { changes: [], next_cursor: 0, has_more: false }, error: null }
        throw new Error(`Unexpected RPC ${name}`)
      }),
    })
    connectivity.setConnection({ isOnline: true, offlineMode: 'offline', offlineModeStatus: 'forced-offline' })
    await adapter.update({ tableName, member: { id: ids.memberId, __canonical_member_id: ids.memberId }, updates: { full_name: 'Local diagnostic edit' } })
    const diagnostic = await adapter.getSafeSyncDiagnostics()
    expect(diagnostic).toMatchObject({ syncState: { pendingChanges: 1 }, memberMutations: [{ memberId: ids.memberId, tableName, operation: 'update_member_v2', saveState: 'LOCAL_PENDING' }] })
    expect(JSON.stringify(diagnostic)).not.toContain('Local diagnostic edit')
    expect(diagnostic.memberMutations[0]).not.toHaveProperty('payload')
  })
})
