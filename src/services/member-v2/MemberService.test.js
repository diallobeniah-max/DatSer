import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { createMemberV2Database } from '../../data/member-v2/rxdb/createMemberV2Database'
import { createMemberService } from './MemberService'
import { MEMBER_CONFLICT_OPERATIONS } from './memberConflict'
import { MEMBER_SAVE_STATES } from './memberSaveState'
import { createMemberV2NetworkController } from '../../experiments/rxdb-member-phase1/NetworkController'
import { createMemberV2Fingerprint } from '../../experiments/rxdb-member-phase1/memberContractFingerprint'

const ids = { user: '11111111-1111-4111-8111-111111111111', owner: '22222222-2222-4222-8222-222222222222', member: '33333333-3333-4333-8333-333333333333' }
const tableName = 'January_2026'
const services = []

const change = ({ memberId = ids.member, revision = 1, name = 'Remote Member', deleted = false } = {}) => ({
  server_revision: revision, table_name: tableName, member_id: memberId, is_deleted: deleted,
  member: { id: memberId, 'Full Name': name, member_code: 'M0001', __source_table: tableName }, changed_at: '2026-01-01T00:00:00.000Z',
})

const rpcClient = (handler) => ({ rpc: handler, removeChannel: async () => {}, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }) })
const makeService = async ({ rpc, online = () => false, connectivity = null } = {}) => {
  const service = await createMemberService({ supabase: rpcClient(rpc), userId: crypto.randomUUID(), ownerId: crypto.randomUUID(), storage: getRxStorageMemory(), online, connectivity })
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

  it('recovers a create whose process stopped after the durable intent but before the member projection', async () => {
    let online = false; const calls = []; const userId = crypto.randomUUID(); const ownerId = crypto.randomUUID()
    let database = await createMemberV2Database({ userId, ownerId, storage: getRxStorageDexie() })
    const options = { database, userId, ownerId, online: () => online, supabase: rpcClient(async (name, args) => { calls.push(name); if (name === 'create_member_v2') return { data: { status: 'SUCCESS', server_revision: 1, table_name: tableName, member: { id: args.p_member_id, ...args.p_member } }, error: null }; return { data: { changes: [], next_cursor: 1, has_more: false }, error: null } }) }
    const first = await createMemberService(options); services.push(first); await first.start()
    const insert = database.members.insert.bind(database.members); database.members.insert = async (...args) => { database.members.insert = insert; throw new Error('simulated process interruption') }
    await expect(first.createMember({ tableName, member: { full_name: 'Recovered create' } })).rejects.toThrow('simulated process interruption')
    const journal = (await database.mutations.find().exec())[0].toJSON(); expect(journal.save_state).toBe(MEMBER_SAVE_STATES.PREPARED)
    await first.stop()
    await database.close(); database = await createMemberV2Database({ userId, ownerId, storage: getRxStorageDexie() }); options.database = database
    const restarted = await createMemberService(options); services.push(restarted); await restarted.start()
    expect(await restarted.getMember(journal.member_id)).toMatchObject({ data: { 'Full Name': 'Recovered create' }, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING })
    online = true; await restarted.syncNow()
    expect(calls.filter((name) => name === 'create_member_v2')).toHaveLength(1)
    expect((await restarted.getMember(journal.member_id)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    await database.close()
  })

  it('replays an interrupted update from its durable intent after service restart', async () => {
    let online = false; const calls = []; const userId = crypto.randomUUID(); const ownerId = crypto.randomUUID()
    let database = await createMemberV2Database({ userId, ownerId, storage: getRxStorageDexie() })
    const options = { database, userId, ownerId, online: () => online, supabase: rpcClient(async (name, args) => { calls.push(name); if (name === 'update_member_v2') return { data: { status: 'SUCCESS', server_revision: 2, table_name: tableName, member: { id: args.p_member_id, 'Full Name': args.p_updates.full_name, member_code: 'M0001' } }, error: null }; return { data: { changes: [change()], next_cursor: 1, has_more: false }, error: null } }) }
    const first = await createMemberService(options); services.push(first); await first.start(); await first.pull()
    let interrupted = false; const findOne = database.members.findOne.bind(database.members)
    database.members.findOne = (...args) => { const query = findOne(...args); const exec = query.exec.bind(query); query.exec = async () => { const target = await exec(); if (!target) return target; return new Proxy(target, { get(object, property) { if (property === 'incrementalPatch') return async (values) => { if (!interrupted && values.data?.['Full Name'] === 'Recovered update') { interrupted = true; throw new Error('simulated process interruption') }; return object.incrementalPatch(values) }; const value = Reflect.get(object, property, object); return typeof value === 'function' ? value.bind(object) : value } }) }; return query }
    await expect(first.updateMember(ids.member, { 'Full Name': 'Recovered update' })).rejects.toThrow('simulated process interruption')
    const journal = (await database.mutations.find({ selector: { member_id: ids.member } }).exec())[0].toJSON(); expect(journal.save_state).toBe(MEMBER_SAVE_STATES.PREPARED)
    await first.stop()
    await database.close(); database = await createMemberV2Database({ userId, ownerId, storage: getRxStorageDexie() }); options.database = database
    const restarted = await createMemberService(options); services.push(restarted); await restarted.start()
    expect((await restarted.getMember(ids.member)).data['Full Name']).toBe('Recovered update')
    online = true; await restarted.syncNow()
    expect(calls.filter((name) => name === 'update_member_v2')).toHaveLength(1)
    expect((await restarted.getMember(ids.member)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    await database.close()
  })

  it('replays an interrupted server delete and keeps its superseding tombstone after restart', async () => {
    let online = false; const calls = []; const userId = crypto.randomUUID(); const ownerId = crypto.randomUUID()
    let database = await createMemberV2Database({ userId, ownerId, storage: getRxStorageDexie() })
    let deleted = false; const options = { database, userId, ownerId, online: () => online, supabase: rpcClient(async (name, args) => { calls.push(name); if (name === 'delete_member_v2') { deleted = true; return { data: { status: 'SUCCESS', server_revision: 2, table_name: tableName, member: { id: args.p_member_id, ...change().member, deleted_at: '2026-01-02T00:00:00.000Z' } }, error: null } }; return { data: { changes: [change({ revision: deleted ? 2 : 1, deleted })], next_cursor: deleted ? 2 : 1, has_more: false }, error: null } }) }
    const first = await createMemberService(options); services.push(first); await first.start(); await first.pull(); await first.updateMember(ids.member, { 'Full Name': 'Pending before delete' })
    const supersededUpdate = (await database.mutations.find({ selector: { member_id: ids.member } }).exec())[0].toJSON().id
    let interrupted = false; const findOne = database.members.findOne.bind(database.members)
    database.members.findOne = (...args) => { const query = findOne(...args); const exec = query.exec.bind(query); query.exec = async () => { const target = await exec(); if (!target) return target; return new Proxy(target, { get(object, property) { if (property === 'incrementalPatch') return async (values) => { if (!interrupted && values.is_deleted === true) { interrupted = true; throw new Error('simulated process interruption') }; return object.incrementalPatch(values) }; const value = Reflect.get(object, property, object); return typeof value === 'function' ? value.bind(object) : value } }) }; return query }
    await expect(first.deleteMember(ids.member)).rejects.toThrow('simulated process interruption')
    const journal = (await database.mutations.find({ selector: { member_id: ids.member } }).exec()).map((row) => row.toJSON()).find((row) => row.operation === 'delete_member_v2'); expect(journal).toMatchObject({ operation: 'delete_member_v2', save_state: MEMBER_SAVE_STATES.PREPARED, supersedes_request_ids: [supersededUpdate] })
    expect((await database.mutations.find({ selector: { member_id: ids.member } }).exec()).map((row) => row.toJSON()).filter((row) => row.operation === 'update_member_v2')).toHaveLength(0)
    await first.stop(); await database.close(); database = await createMemberV2Database({ userId, ownerId, storage: getRxStorageDexie() }); options.database = database
    const restarted = await createMemberService(options); services.push(restarted); await restarted.start()
    expect(await restarted.getMember(ids.member)).toMatchObject({ is_deleted: true, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING })
    expect((await database.mutations.find({ selector: { member_id: ids.member } }).exec()).map((row) => row.toJSON()).map((row) => row.operation)).toEqual(['delete_member_v2'])
    online = true; await restarted.syncNow()
    expect(calls.filter((name) => name === 'delete_member_v2')).toHaveLength(1)
    expect(await restarted.getMember(ids.member)).toMatchObject({ is_deleted: true, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    await database.close()
  })

  it('keeps a member mutation LOCAL_PENDING and makes zero backend calls during simulated offline', async () => {
    const storage = new Map(); const connectivity = createMemberV2NetworkController({ storage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } }); connectivity.setSimulatedOffline(true)
    const calls = []; const service = await makeService({ connectivity, rpc: async (name, args) => { calls.push({ name, args }); return { data: { changes: [], has_more: false }, error: null } } })
    const member = await service.createMember({ tableName, member: { full_name: 'Offline only' } }); await service.syncNow()
    expect(calls).toEqual([])
    expect((await service.getMember(member.id)).save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING)
    expect((await service.getSyncState())).toMatchObject({ state: 'OFFLINE_PENDING', pendingChanges: 1 })
  })

  it('automatically retries the same member request after simulated offline ends', async () => {
    const storage = new Map(); const connectivity = createMemberV2NetworkController({ storage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } }); connectivity.setSimulatedOffline(true)
    const requests = []; const service = await makeService({ connectivity, rpc: async (name, args) => { if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [], next_cursor: 1, has_more: false }, error: null }; requests.push(args.p_request_id); return { data: { status: 'SUCCESS', server_revision: 1, table_name: tableName, member: { id: args.p_member_id, 'Full Name': args.p_member['Full Name'], member_code: 'M9001' } }, error: null } } })
    const member = await service.createMember({ tableName, member: { full_name: 'Reconnect member' } }); const pending = (await service.database.mutations.find({ selector: { member_id: member.id } }).exec())[0].toJSON()
    connectivity.setSimulatedOffline(false); await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requests).toEqual([pending.id]); expect((await service.getMember(member.id)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
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

  it('keeps a confirmed member delete local while offline and reuses its durable request on reconnect', async () => {
    let online = false; let deleted = false; const calls = []
    const rpc = async (name, args) => {
      calls.push({ name, args })
      if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [change({ revision: deleted ? 2 : 1, deleted })], next_cursor: deleted ? 2 : 1, has_more: false }, error: null }
      if (name === 'delete_member_v2') {
        deleted = true
        return { data: { status: 'SUCCESS', server_revision: 2, table_name: tableName, member: { ...change().member, deleted_at: '2026-01-02T00:00:00.000Z' } }, error: null }
      }
      throw new Error(`Unexpected RPC ${name}`)
    }
    const service = await makeService({ rpc, online: () => online })
    await service.pull()
    await service.deleteMember(ids.member)
    const pending = (await service.database.mutations.find({ selector: { member_id: ids.member } }).exec())[0].toJSON()
    expect((await service.getMember(ids.member)).is_deleted).toBe(true)
    expect(calls.some((call) => call.name === 'delete_member_v2')).toBe(false)
    online = true; await service.syncNow()
    expect(calls.find((call) => call.name === 'delete_member_v2').args.p_request_id).toBe(pending.id)
    expect((await service.getMember(ids.member)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
  })

  it('removes an unconfirmed local create and its mutation instead of replaying a delete', async () => {
    const service = await makeService({ rpc: async () => { throw new Error('offline') } })
    const local = await service.createMember({ tableName, member: { full_name: 'Never sent' } })
    await service.deleteMember(local.id)
    expect(await service.getMember(local.id)).toBeNull()
    expect((await service.getSyncState()).pendingChanges).toBe(0)
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
    const ownerId = crypto.randomUUID()
    const client = { rpc, removeChannel: async () => {}, channel: () => ({ on: (_event, _filter, listener) => { listeners.push(listener); return { subscribe: () => ({}) } } }) }
    const service = await createMemberService({ supabase: client, userId: crypto.randomUUID(), ownerId, storage: getRxStorageMemory(), online: () => online, realtimeDebounceMs: 0 })
    services.push(service); await service.start(); online = true; listeners[0]({ new: { owner_id: ownerId } })
    await vi.waitFor(async () => expect((await service.getSyncState()).state).toBe('SYNCED'))
  })

  it('uses an unfiltered RLS-scoped signal channel and wakes only for its workspace owner', async () => {
    let online = false
    let pullCount = 0
    let subscription = null
    let listener = null
    const ownerId = ids.owner
    const channel = {
      on: (event, filter, callback) => {
        subscription = { event, filter }
        listener = callback
        return channel
      },
      subscribe: (callback) => { callback?.('SUBSCRIBED'); return channel },
    }
    const supabase = {
      channel: () => channel,
      removeChannel: async () => {},
      rpc: async (name) => {
        if (name === 'pull_workspace_member_changes_v2') pullCount += 1
        return { data: { changes: [], next_cursor: null, has_more: false }, error: null }
      },
    }
    const service = await createMemberService({
      supabase, userId: ids.user, ownerId, storage: getRxStorageMemory(),
      online: () => online, realtimeDebounceMs: 0,
    })
    services.push(service)
    await service.start()
    expect(subscription).toEqual({
      event: 'postgres_changes',
      filter: { event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals' },
    })

    online = true
    listener({ new: { owner_id: '44444444-4444-4444-8444-444444444444', latest_server_revision: 9 } })
    listener({ new: { owner_id: 'not-a-uuid', latest_server_revision: 10 } })
    listener({ new: {} })
    listener({ new: null })
    listener(null)
    await Promise.resolve()
    expect(pullCount).toBe(0)

    listener({ new: { owner_id: ownerId, latest_server_revision: 11 } })
    await vi.waitFor(() => expect(pullCount).toBe(1))
  })

  it('waits for realtime socket teardown before recreating one channel and waking one pull', async () => {
    let online = true
    let disconnecting = false
    let resolveDisconnectWaitEntered
    const disconnectWaitEntered = new Promise((resolve) => { resolveDisconnectWaitEntered = resolve })
    let reconnectRequested = false
    let connectivityListener = null
    let pullCount = 0
    const channels = []
    const activeChannels = new Set()
    const realtime = {
      isDisconnecting: () => {
        if (disconnecting && reconnectRequested) resolveDisconnectWaitEntered()
        return disconnecting
      },
    }
    const supabase = {
      realtime,
      rpc: async (name) => {
        if (name === 'pull_workspace_member_changes_v2') pullCount += 1
        return { data: { changes: [], next_cursor: null, has_more: false }, error: null }
      },
      channel: () => {
        const listeners = []
        const channel = {
          state: 'joining',
          on: (_event, _filter, listener) => { listeners.push(listener); return channel },
          subscribe: (callback) => { channel.state = 'joined'; callback?.('SUBSCRIBED'); channel.listeners = listeners; return channel },
        }
        channels.push(channel)
        activeChannels.add(channel)
        return channel
      },
      removeChannel: async (channel) => {
        activeChannels.delete(channel)
        channel.state = 'closed'
        disconnecting = true
        return 'ok'
      },
    }
    const connectivity = {
      isBackendReachable: () => online,
      subscribe: (listener) => { connectivityListener = listener; return () => { connectivityListener = null } },
    }
    const service = await createMemberService({
      supabase, userId: ids.user, ownerId: ids.owner, storage: getRxStorageMemory(), connectivity, realtimeDebounceMs: 0,
    })
    services.push(service)
    await service.start()
    expect(channels).toHaveLength(1)
    const firstChannel = channels[0]

    online = false
    await connectivityListener('OFFLINE')
    expect(firstChannel.state).toBe('closed')
    expect(activeChannels.size).toBe(0)
    expect(realtime.isDisconnecting()).toBe(true)

    online = true
    reconnectRequested = true
    const reconnect = connectivityListener('ONLINE')
    await disconnectWaitEntered
    expect(channels).toHaveLength(1)
    expect(activeChannels.size).toBe(0)

    disconnecting = false
    await reconnect
    expect(channels).toHaveLength(2)
    expect(activeChannels.size).toBe(1)
    expect(channels[1]).not.toBe(firstChannel)
    expect(channels[1].state).toBe('joined')

    const pullsBeforeWake = pullCount
    channels[1].listeners[0]({ new: { owner_id: ids.owner, latest_server_revision: 12 } })
    await vi.waitFor(() => expect(pullCount).toBe(pullsBeforeWake + 1))
    expect(activeChannels.size).toBe(1)
    expect(channels).toHaveLength(2)
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

  it('rebases sequential local edits with a matching fingerprint instead of manufacturing a conflict', async () => {
    let online = false; let revision = 1; let initialPull = true; const writes = []
    const rpc = async (name, args) => {
      if (name === 'pull_workspace_member_changes_v2') {
        const changes = initialPull ? [change({ revision, name: 'Original server value' })] : []
        initialPull = false
        return { data: { changes, next_cursor: revision, has_more: false }, error: null }
      }
      const expectedFingerprint = await createMemberV2Fingerprint({ operation: 'update_member_v2', ownerId: service.ownerId, tableName: args.p_table_name, memberId: args.p_member_id, baseServerRevision: args.p_base_server_revision, payload: args.p_updates })
      writes.push({ requestId: args.p_request_id, revision: args.p_base_server_revision, fingerprint: args.p_payload_fingerprint })
      if (args.p_payload_fingerprint !== expectedFingerprint) return { data: null, error: new Error('Payload fingerprint does not match the canonical member mutation') }
      if (args.p_base_server_revision !== revision) return { data: { status: 'CONFLICT', server_revision: revision, table_name: tableName, member: change({ revision, name: 'Server value' }).member }, error: null }
      revision += 1
      return { data: { status: 'SUCCESS', server_revision: revision, table_name: tableName, member: { id: args.p_member_id, 'Full Name': args.p_updates['Full Name'], member_code: 'M0001' } }, error: null }
    }
    const service = await makeService({ rpc, online: () => online })
    await service.pull()
    await service.updateMember(ids.member, { 'Full Name': 'First local edit' })
    await service.updateMember(ids.member, { 'Full Name': 'Second local edit' })
    online = true
    await service.syncNow()

    expect(writes.map((write) => write.revision)).toEqual([1, 2])
    expect(new Set(writes.map((write) => write.requestId)).size).toBe(2)
    expect((await service.getMember(ids.member))).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, server_revision: 3, data: { 'Full Name': 'Second local edit', member_code: 'M0001' } })
    expect((await service.getSyncState())).toMatchObject({ state: 'SYNCED', pendingChanges: 0, conflicts: 0 })
  })

  it('retargets only a pre-reservation unregistered-month create with its original request ID', async () => {
    let online = false; const requests = []; const rejectedTable = 'December_2025'; const trustedTable = 'January_2026'
    const rpc = async (name, args) => {
      if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [], next_cursor: null, has_more: false }, error: null }
      requests.push({ tableName: args.p_table_name, requestId: args.p_request_id })
      if (args.p_table_name === rejectedTable) return { data: null, error: { message: 'This logical month is not registered for the workspace' } }
      return { data: { status: 'SUCCESS', server_revision: 9, table_name: trustedTable, member: { id: args.p_member_id, 'Full Name': args.p_member['Full Name'], member_code: 'M0009' } }, error: null }
    }
    const service = await makeService({ rpc, online: () => online })
    const local = await service.createMember({ tableName: rejectedTable, member: { full_name: 'Recovered local member' } })
    const before = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].toJSON()
    online = true; await service.syncNow()
    expect((await service.getMember(local.id)).last_error).toBe('This logical month is not registered for the workspace')
    const repaired = await service.recoverUnregisteredTargetCreates({ tableName: trustedTable })
    expect(repaired).toMatchObject({ recovered: 1, requestIds: [before.id] })
    await service.syncNow()
    const confirmed = await service.getMember(local.id)
    expect(confirmed).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, table_name: trustedTable })
    expect(confirmed.data.member_code).toBe('M0009')
    expect(requests).toEqual([{ tableName: rejectedTable, requestId: before.id }, { tableName: trustedTable, requestId: before.id }])
  })

  it('retries an unsupported-field create with the same request ID and no unsupported payload field', async () => {
    let online = false; const payloads = []
    const rpc = async (name, args) => {
      if (name === 'pull_workspace_member_changes_v2') return { data: { changes: [], next_cursor: null, has_more: false }, error: null }
      payloads.push({ requestId: args.p_request_id, member: args.p_member })
      if (args.p_member.date_of_birth) return { data: null, error: { message: 'Unsupported member field' } }
      return { data: { status: 'SUCCESS', server_revision: 10, table_name: tableName, member: { id: args.p_member_id, 'Full Name': args.p_member['Full Name'], member_code: 'M0010' } }, error: null }
    }
    const service = await makeService({ rpc, online: () => online }); const local = await service.createMember({ tableName, member: { full_name: 'Compatible profile', date_of_birth: '2012-01-01', notes: 'Kept' } })
    const requestId = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].id
    online = true; await service.syncNow(); expect((await service.getMember(local.id)).last_error).toBe('Unsupported member field')
    const repaired = await service.recoverUnsupportedFieldCreates({ fields: ['Full Name', 'notes'] })
    expect(repaired).toMatchObject({ recovered: 1, requestIds: [requestId], removedFields: ['date_of_birth'] })
    await service.syncNow()
    expect((await service.getMember(local.id)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    expect(payloads).toEqual([{ requestId, member: { 'Full Name': 'Compatible profile', date_of_birth: '2012-01-01', notes: 'Kept' } }, { requestId, member: { 'Full Name': 'Compatible profile', notes: 'Kept' } }])
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
