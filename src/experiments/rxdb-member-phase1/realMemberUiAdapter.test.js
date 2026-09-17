import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRealMemberV2UiAdapter, resetRealMemberV2UiAdapterForTests } from './realMemberUiAdapter'
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
    await new Promise((resolve) => setTimeout(resolve, 50))
    const update = calls.find((call) => call.name === 'update_member_v2')
    expect(update).toBeTruthy()
    expect(update.args.p_request_id).toMatch(/^update_member_v2:/)
    expect((await adapter.refreshGuard()).pendingChanges).toBe(0)
  })
})
