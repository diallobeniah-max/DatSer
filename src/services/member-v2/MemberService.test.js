import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { createMemberService } from './MemberService'
import { MEMBER_CONFLICT_OPERATIONS } from './memberConflict'
import { MEMBER_SAVE_STATES } from './memberSaveState'

const ids = { user: '11111111-1111-4111-8111-111111111111', owner: '22222222-2222-4222-8222-222222222222', member: '33333333-3333-4333-8333-333333333333' }
const tableName = 'January_2026'
const services = []

const change = ({ memberId = ids.member, revision = 1, name = 'Remote Member', deleted = false } = {}) => ({
  server_revision: revision, table_name: tableName, member_id: memberId, is_deleted: deleted,
  member: { id: memberId, 'Full Name': name, member_code: 'M0001', __source_table: tableName }, changed_at: '2026-01-01T00:00:00.000Z',
})

const rpcClient = (handler) => ({ rpc: handler, removeChannel: async () => {}, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }) })
const makeService = async ({ rpc, online = () => false } = {}) => {
  const service = await createMemberService({ supabase: rpcClient(rpc), userId: crypto.randomUUID(), ownerId: crypto.randomUUID(), storage: getRxStorageMemory(), online })
  services.push(service); await service.start(); return service
}

afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.stop())) })

describe('Member V2 local-first service', () => {
  it('writes a client UUID and durable request before a network request', async () => {
    const rpc = async () => { throw new Error('network must not be reached while offline') }
    const service = await makeService({ rpc })
    const member = await service.createMember({ tableName, member: { full_name: ' Local Person ' } })
    expect(member.data['Full Name']).toBe('Local Person')
    expect(member.save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING)
    const pending = await service.getSyncState()
    expect(pending.pendingChanges).toBe(1)
  })

  it('sends the exact durable request ID and confirms only an acknowledged create', async () => {
    let online = false; const calls = []
    const rpc = async (name, args) => {
      calls.push({ name, args })
      if (name === 'create_member_v2') return { data: { status: 'SUCCESS', server_revision: 4, table_name: tableName, member: { id: args.p_member_id, 'Full Name': args.p_member.full_name, member_code: 'M0001' } }, error: null }
      return { data: { changes: [], next_cursor: 4, has_more: false }, error: null }
    }
    const service = await makeService({ rpc, online: () => online })
    const member = await service.createMember({ tableName, member: { full_name: 'Confirmed' } })
    const mutation = await service.database.mutations.find({ selector: { member_id: member.id } }).exec()
    const requestId = mutation[0].id
    online = true; await service.syncNow()
    expect(calls.find((call) => call.name === 'create_member_v2').args.p_request_id).toBe(requestId)
    expect((await service.getMember(member.id)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    expect((await service.getMember(member.id)).data.member_code).toBe('M0001')
    expect((await service.getSyncState()).pendingChanges).toBe(0)
  })

  it('does not let a pull overwrite a durable local edit', async () => {
    let online = false; let pull = [change()]
    const rpc = async (name) => name === 'pull_workspace_member_changes_v2'
      ? { data: { changes: pull, next_cursor: pull.at(-1)?.server_revision || 1, has_more: false }, error: null }
      : { data: { status: 'SUCCESS', server_revision: 2, table_name: tableName, member: change({ revision: 2, name: 'Local edit' }).member }, error: null }
    const service = await makeService({ rpc, online: () => online })
    await service.pull()
    await service.updateMember(ids.member, { 'Full Name': 'Local edit' })
    pull = [change({ revision: 2, name: 'Remote edit' })]
    await service.pull()
    expect((await service.getMember(ids.member)).data['Full Name']).toBe('Local edit')
    expect((await service.getMember(ids.member)).save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING)
  })

  it('keeps conflicts recoverable and can use the server copy', async () => {
    let online = false
    const rpc = async (name) => {
      if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [change()], next_cursor: 1, has_more: false }, error: null }
      return { data: { status: 'CONFLICT', server_revision: 2, table_name: tableName, member: change({ revision: 2, name: 'Server wins' }).member }, error: null }
    }
    const service = await makeService({ rpc, online: () => online })
    await service.pull(); await service.updateMember(ids.member, { 'Full Name': 'Local wants this' })
    online = true; await service.syncNow()
    expect((await service.getMember(ids.member)).save_state).toBe(MEMBER_SAVE_STATES.CONFLICT)
    await service.resolveConflict(ids.member, MEMBER_CONFLICT_OPERATIONS.USE_SERVER)
    const resolved = await service.getMember(ids.member)
    expect(resolved.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    expect(resolved.data['Full Name']).toBe('Server wins')
  })

  it('keeps database names isolated by user and workspace owner', async () => {
    const rpc = async () => ({ data: { changes: [], next_cursor: null, has_more: false }, error: null })
    const service = await makeService({ rpc })
    expect(service.database.name).toContain(service.userId.replaceAll('-', '_'))
    expect(service.database.name).toContain(service.ownerId.replaceAll('-', '_'))
  })

  it('treats a realtime signal as one debounced cursor-pull wake-up', async () => {
    let online = false; const listeners = []; const rpc = async () => ({ data: { changes: [], next_cursor: null, has_more: false }, error: null })
    const client = { rpc, removeChannel: async () => {}, channel: () => ({ on: (_event, _filter, listener) => { listeners.push(listener); return { subscribe: () => ({}) } } }) }
    const service = await createMemberService({ supabase: client, userId: crypto.randomUUID(), ownerId: crypto.randomUUID(), storage: getRxStorageMemory(), online: () => online, realtimeDebounceMs: 0 })
    services.push(service); await service.start(); online = true; listeners[0](); await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await service.getSyncState()).state).toBe('SYNCED')
  })

  it('keeps the same request ID after a retryable network failure', async () => {
    let online = false; let attempts = 0; const idsSeen = []
    const rpc = async (name, args) => {
      if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [], next_cursor: null, has_more: false }, error: null }
      idsSeen.push(args.p_request_id); attempts += 1
      return attempts === 1 ? { data: null, error: new Error('offline') } : { data: { status: 'SUCCESS', server_revision: 1, table_name: tableName, member: { id: args.p_member_id, 'Full Name': args.p_member['Full Name'], member_code: 'M0001' } }, error: null }
    }
    const service = await makeService({ rpc, online: () => online }); const member = await service.createMember({ tableName, member: { full_name: 'Retry stable' } })
    online = true; await service.syncNow(); expect((await service.getMember(member.id)).save_state).toBe(MEMBER_SAVE_STATES.FAILED_RETRYABLE)
    await service.syncNow(); expect((await service.getMember(member.id)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    expect(idsSeen).toHaveLength(2); expect(idsSeen[0]).toBe(idsSeen[1])
  })

  it('creates a new request when keeping local conflict values', async () => {
    let online = false
    const rpc = async (name) => name === 'pull_workspace_member_changes_v2'
      ? { data: { changes: [change()], next_cursor: 1, has_more: false }, error: null }
      : { data: { status: 'CONFLICT', server_revision: 2, table_name: tableName, member: change({ revision: 2, name: 'Remote state' }).member }, error: null }
    const service = await makeService({ rpc, online: () => online }); await service.pull(); await service.updateMember(ids.member, { 'Full Name': 'Keep local' })
    const before = (await service.database.mutations.find({ selector: { member_id: ids.member } }).exec())[0].id
    online = true; await service.syncNow(); online = false; await service.resolveConflict(ids.member, MEMBER_CONFLICT_OPERATIONS.KEEP_LOCAL)
    const after = (await service.database.mutations.find({ selector: { member_id: ids.member } }).exec())[0]
    expect(after.id).not.toBe(before); expect(after.base_server_revision).toBe(2); expect((await service.getMember(ids.member)).data['Full Name']).toBe('Keep local')
  })
})
