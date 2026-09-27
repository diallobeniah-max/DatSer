import { createMemberV2Fingerprint } from '../../experiments/rxdb-member-phase1/memberContractFingerprint'
import { createMemberV2Database, createMemberV2ScopeKey } from '../../data/member-v2/rxdb/createMemberV2Database'
import { MEMBER_CONFLICT_OPERATIONS, assertConflictOperation, parseConflictRemote } from './memberConflict'
import { MEMBER_SAVE_STATES, isPendingMemberSaveState } from './memberSaveState'
import { assertMemberTarget, createHistoricalIdentity, targetFromMember } from './memberTarget'
import { editableMemberPayload, mergeMemberPayload, toServerMemberPayload, validateMemberPayload } from './memberValidation'

const PULL_LIMIT = 100
const DEFAULT_BATCH_SIZE = 25
// Mutations are ordered by this durable timestamp. Date.now() alone can give
// several consecutive edits the same millisecond, leaving RxDB free to replay
// them in a different order after a restart.
let lastTimestampMs = 0
const now = () => {
  lastTimestampMs = Math.max(Date.now(), lastTimestampMs + 1)
  return new Date(lastTimestampMs).toISOString()
}
const newId = (kind, memberId) => `${kind}:${memberId}:${globalThis.crypto.randomUUID()}`
const asJson = (document) => document?.toJSON?.() || document

const onlineByDefault = () => typeof navigator === 'undefined' || navigator.onLine !== false
const TARGET_NOT_REGISTERED_ERROR = 'This logical month is not registered for the workspace'
const UNSUPPORTED_FIELD_ERROR = 'Unsupported member field'

// This error happens before the server reserves the request ID. Only that
// narrow case may be explicitly retargeted by the local POC recovery flow.
const isRecoverableUnregisteredTargetFailure = (mutation) => mutation?.operation === 'create_member_v2'
  && mutation?.save_state === MEMBER_SAVE_STATES.FAILED_RETRYABLE
  && mutation?.last_error === TARGET_NOT_REGISTERED_ERROR
const isRecoverableUnsupportedFieldFailure = (mutation) => mutation?.operation === 'create_member_v2'
  && mutation?.save_state === MEMBER_SAVE_STATES.FAILED_RETRYABLE
  && mutation?.last_error === UNSUPPORTED_FIELD_ERROR

const traceMemberV2Realtime = (event) => {
  if (typeof window === 'undefined') return
  const trace = window.__datserMemberV2IdTrace
  if (!trace?.enabled) return
  trace.events ||= []
  trace.events.push({ at: new Date().toISOString(), ...event })
}

const memberFields = (data, { userId, ownerId, tableName, memberId, identity, saveState, requestId = null, operation = null, fingerprint = null, baseRevision = null, retryCount = 0, conflict = null } = {}) => ({
  workspace_id: ownerId, workspace_owner_id: ownerId, authenticated_user_scope: userId,
  source_table: tableName || data?.__source_table || null, canonical_member_id: memberId || data?.__canonical_member_id || data?.id || null,
  provenance: identity || null, full_name: data?.['Full Name'] ?? data?.full_name ?? data?.Name ?? data?.name ?? null,
  phone: data?.['Phone Number'] ?? data?.phone_number ?? data?.phone ?? null, age: data?.Age ?? data?.age ?? null,
  education: data?.['Current Level'] ?? data?.current_level ?? null, gender: data?.Gender ?? data?.gender ?? null,
  member_code: data?.member_code ?? null, tags: Array.isArray(data?.tags) ? data.tags.map(String) : null,
  local_save_state: saveState, pending_request_id: requestId, pending_operation: operation, payload_fingerprint: fingerprint,
  base_server_revision: baseRevision, retry_count: retryCount, remote_conflict_snapshot: conflict,
})

const serverDocument = ({ scopeKey, userId, ownerId, tableName, change, prior }) => ({
  id: String(change.member_id), scope_key: scopeKey, user_id: userId, owner_id: ownerId,
  table_name: change.table_name || tableName, member_id: String(change.member_id),
  identity: prior?.identity || null, data: change.member || {}, server_revision: Number(change.server_revision),
  is_deleted: Boolean(change.is_deleted), save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED,
  conflict_remote: null, last_error: null, retry_count: 0,
  ...memberFields(change.member || {}, { userId, ownerId, tableName: change.table_name || tableName, memberId: String(change.member_id), identity: prior?.identity, saveState: MEMBER_SAVE_STATES.SERVER_CONFIRMED }),
  created_at: prior?.created_at || change.changed_at || now(), updated_at: change.changed_at || now(),
})

export class MemberService {
  constructor({ supabase, userId, ownerId, database, online = onlineByDefault, connectivity = null, batchSize = DEFAULT_BATCH_SIZE, realtimeDebounceMs = 350, closeDatabase = false }) {
    if (!supabase?.rpc) throw new Error('Member V2 requires an authenticated Supabase client.')
    if (!userId || !ownerId || !database) throw new Error('Member V2 requires an authenticated user, workspace owner, and local database.')
    this.supabase = supabase; this.userId = userId; this.ownerId = ownerId; this.database = database
    this.scopeKey = createMemberV2ScopeKey({ userId, ownerId }); this.online = online; this.connectivity = connectivity; this.batchSize = Math.min(Math.max(batchSize, 1), DEFAULT_BATCH_SIZE)
    this.realtimeDebounceMs = realtimeDebounceMs; this.closeDatabase = closeDatabase; this.channel = null; this.realtimeTimer = null; this.syncPromise = null; this.connectivityUnsubscribe = null; this.connectivityChangePromise = Promise.resolve()
  }

  static async create(options) {
    const database = options.database || await createMemberV2Database(options)
    return new MemberService({ ...options, database, closeDatabase: !options.database })
  }

  async start() {
    await this.#syncDocument()
    this.connectivityUnsubscribe = this.connectivity?.subscribe(() => this.#queueConnectivityChange()) || null
    this.#subscribeRealtime()
    if (this.#isBackendReachable()) void this.syncNow()
    return this
  }

  async stop() {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
    this.connectivityUnsubscribe?.(); this.connectivityUnsubscribe = null
    await this.connectivityChangePromise.catch(() => {})
    // A reload/close can race the automatic start-up pull. Let that bounded
    // promise settle before closing RxDB so its checkpoint update cannot land
    // on a closed collection.
    await this.syncPromise?.catch(() => {})
    await this.#unsubscribeRealtime()
    if (this.closeDatabase) await this.database.close()
  }

  async createMember({ tableName, member, identity = null }) {
    const memberId = globalThis.crypto.randomUUID()
    assertMemberTarget({ ownerId: this.ownerId, tableName, memberId })
    const payload = toServerMemberPayload(validateMemberPayload(member, { requireName: true }), identity?.field_map)
    const timestamp = now(); const requestId = newId('create_member_v2', memberId); const fingerprint = await this.#fingerprint({ operation: 'create_member_v2', tableName, memberId, baseServerRevision: null, payload })
    await this.database.members.insert({ id: memberId, scope_key: this.scopeKey, user_id: this.userId, owner_id: this.ownerId, table_name: tableName, member_id: memberId, identity, data: payload, server_revision: null, is_deleted: false, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, conflict_remote: null, last_error: null, retry_count: 0, ...memberFields(payload, { userId: this.userId, ownerId: this.ownerId, tableName, memberId, identity, saveState: MEMBER_SAVE_STATES.LOCAL_PENDING, requestId, operation: 'create_member_v2', fingerprint }), created_at: timestamp, updated_at: timestamp })
    await this.#insertMutation({ id: requestId, memberId, tableName, operation: 'create_member_v2', payload, identity, baseServerRevision: null, fingerprint })
    this.#scheduleSync()
    return this.getMember(memberId)
  }

  async updateMember(memberId, updates, options = {}) {
    const member = await this.getMember(memberId)
    if (!member) throw new Error('Member is not available in this local workspace.')
    if (member.is_deleted) throw new Error('A deleted member cannot be edited.')
    const target = assertMemberTarget({ ownerId: this.ownerId, tableName: options.tableName || member.table_name, memberId })
    const payload = toServerMemberPayload(validateMemberPayload(updates), options.identity?.field_map || member.identity?.field_map)
    const requestId = newId('update_member_v2', memberId); const timestamp = now(); const identity = options.identity || createHistoricalIdentity(member); const baseServerRevision = member.server_revision || 0; const fingerprint = await this.#fingerprint({ operation: 'update_member_v2', tableName: target.tableName, memberId, baseServerRevision, payload })
    const nextData = mergeMemberPayload(member.data, payload)
    await this.#patch(this.database.members, memberId, { table_name: target.tableName, data: nextData, identity, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, conflict_remote: null, last_error: null, ...memberFields(nextData, { userId: this.userId, ownerId: this.ownerId, tableName: target.tableName, memberId, identity, saveState: MEMBER_SAVE_STATES.LOCAL_PENDING, requestId, operation: 'update_member_v2', fingerprint, baseRevision: baseServerRevision, retryCount: member.retry_count || 0 }), updated_at: timestamp })
    await this.#insertMutation({ id: requestId, memberId, tableName: target.tableName, operation: 'update_member_v2', payload, identity, baseServerRevision, fingerprint })
    this.#scheduleSync()
    return this.getMember(memberId)
  }

  async deleteMember(memberId, options = {}) {
    const member = await this.getMember(memberId)
    if (!member) throw new Error('Member is not available in this local workspace.')
    if (member.is_deleted) return member
    const target = assertMemberTarget({ ownerId: this.ownerId, tableName: options.tableName || member.table_name, memberId })
    const pending = await this.#mutationsForMember(memberId, [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE, MEMBER_SAVE_STATES.SYNCING, MEMBER_SAVE_STATES.CONFLICT])

    // A member which never reached the server has no historical row to delete.
    // Removing every local mutation prevents its create/update from being replayed
    // after a restart and therefore prevents a deleted local member being revived.
    if (!member.server_revision) {
      await Promise.all(pending.map((mutation) => this.database.mutations.findOne(mutation.id).remove()))
      await this.database.members.findOne(memberId).remove()
      return null
    }

    await Promise.all(pending.map((mutation) => this.database.mutations.findOne(mutation.id).remove()))
    const requestId = newId('delete_member_v2', memberId)
    const baseServerRevision = Number(member.server_revision)
    const payload = {}
    const fingerprint = await this.#fingerprint({ operation: 'delete_member_v2', tableName: target.tableName, memberId, baseServerRevision, payload })
    await this.#patch(this.database.members, memberId, {
      table_name: target.tableName,
      is_deleted: true,
      save_state: MEMBER_SAVE_STATES.LOCAL_PENDING,
      conflict_remote: null,
      last_error: null,
      ...memberFields(member.data, { userId: this.userId, ownerId: this.ownerId, tableName: target.tableName, memberId, identity: member.identity, saveState: MEMBER_SAVE_STATES.LOCAL_PENDING, requestId, operation: 'delete_member_v2', fingerprint, baseRevision: baseServerRevision, retryCount: member.retry_count || 0 }),
      updated_at: now(),
    })
    await this.#insertMutation({ id: requestId, memberId, tableName: target.tableName, operation: 'delete_member_v2', payload, identity: member.identity, baseServerRevision, fingerprint })
    this.#scheduleSync()
    return this.getMember(memberId)
  }

  async listTrustedSourceTables() {
    this.#assertBackendReachable()
    if (!this.supabase?.from) throw new Error('The authenticated client cannot list workspace months.')
    const { data, error } = await this.supabase
      .from('workspace_month_tables')
      .select('table_name, month_start')
      .eq('owner_id', this.ownerId)
      .order('month_start', { ascending: false })
    if (error) throw error
    return (data || []).filter((month) => /^[A-Z][a-z]+_[0-9]{4}$/.test(month.table_name))
  }

  async getSourceTableCapabilities(tableName) {
    this.#assertBackendReachable()
    const { data, error } = await this.supabase.rpc('member_v2_source_table_capabilities', { p_owner_id: this.ownerId, p_table_name: tableName })
    if (error) throw error
    if (data?.status !== 'SUCCESS' || !Array.isArray(data.fields)) throw new Error('The server did not confirm source-month capabilities.')
    return { tableName: data.table_name, fields: new Set(data.fields) }
  }

  async recoverUnregisteredTargetCreates({ tableName }) {
    assertMemberTarget({ ownerId: this.ownerId, tableName, memberId: globalThis.crypto.randomUUID() })
    const candidates = (await this.database.mutations.find({ selector: { scope_key: this.scopeKey, save_state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, operation: 'create_member_v2' } }).exec())
      .map(asJson)
      .filter(isRecoverableUnregisteredTargetFailure)
    for (const mutation of candidates) {
      const fingerprint = await this.#fingerprint({ operation: mutation.operation, tableName, memberId: mutation.member_id, baseServerRevision: null, payload: mutation.payload })
      await this.#patch(this.database.mutations, mutation.id, { table_name: tableName, payload_fingerprint: fingerprint, base_server_revision: null, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, last_error: null, updated_at: now() })
      await this.#patch(this.database.members, mutation.member_id, { table_name: tableName, source_table: tableName, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, local_save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, pending_request_id: mutation.id, pending_operation: mutation.operation, payload_fingerprint: fingerprint, base_server_revision: null, last_error: null, updated_at: now() })
    }
    if (candidates.length) this.#scheduleSync()
    return { recovered: candidates.length, requestIds: candidates.map((mutation) => mutation.id) }
  }

  async recoverUnsupportedFieldCreates({ fields }) {
    const supportedFields = new Set(fields || [])
    const candidates = (await this.database.mutations.find({ selector: { scope_key: this.scopeKey, save_state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, operation: 'create_member_v2' } }).exec())
      .map(asJson)
      .filter(isRecoverableUnsupportedFieldFailure)
    const removedFields = new Set()
    for (const mutation of candidates) {
      const payload = Object.fromEntries(Object.entries(mutation.payload).filter(([key]) => {
        const keep = supportedFields.has(key)
        if (!keep) removedFields.add(key)
        return keep
      }))
      const fingerprint = await this.#fingerprint({ operation: mutation.operation, tableName: mutation.table_name, memberId: mutation.member_id, baseServerRevision: null, payload })
      await this.#patch(this.database.mutations, mutation.id, { payload, payload_fingerprint: fingerprint, base_server_revision: null, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, last_error: null, updated_at: now() })
      await this.#patch(this.database.members, mutation.member_id, { data: mergeMemberPayload({}, payload), save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, local_save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, pending_request_id: mutation.id, pending_operation: mutation.operation, payload_fingerprint: fingerprint, base_server_revision: null, last_error: null, updated_at: now() })
    }
    if (candidates.length) this.#scheduleSync()
    return { recovered: candidates.length, requestIds: candidates.map((mutation) => mutation.id), removedFields: [...removedFields].sort() }
  }

  async getMember(memberId) { return asJson(await this.database.members.findOne(memberId).exec()) }
  observeMember(memberId) { return this.database.members.findOne(memberId).$ }
  observeMembers({ includeDeleted = false } = {}) {
    const selector = includeDeleted ? { scope_key: this.scopeKey } : { scope_key: this.scopeKey, is_deleted: false }
    return this.database.members.find({ selector }).$
  }

  async refreshMember(memberId) { await this.pull(); return this.getMember(memberId) }

  async awaitServerConfirmation(requestId, { timeoutMs = 15000, intervalMs = 120 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const mutation = asJson(await this.database.mutations.findOne(requestId).exec())
      if (!mutation) return { state: MEMBER_SAVE_STATES.SERVER_CONFIRMED }
      if ([MEMBER_SAVE_STATES.CONFLICT, MEMBER_SAVE_STATES.FAILED_RETRYABLE].includes(mutation.save_state)) return { state: mutation.save_state, mutation }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return { state: 'PENDING_TIMEOUT' }
  }

  async resolveConflict(memberId, operation, { merged = null } = {}) {
    assertConflictOperation(operation)
    const member = await this.getMember(memberId)
    const remote = parseConflictRemote(member?.conflict_remote)
    if (!member || member.save_state !== MEMBER_SAVE_STATES.CONFLICT || !remote?.member) throw new Error('No recoverable Member V2 conflict exists for this member.')
    const conflictMutations = await this.#mutationsForMember(memberId, [MEMBER_SAVE_STATES.CONFLICT])
    if (operation === MEMBER_CONFLICT_OPERATIONS.USE_SERVER) {
      await Promise.all(conflictMutations.map((mutation) => this.database.mutations.findOne(mutation.id).remove()))
      const tableName = remote.table_name || member.table_name
      await this.#patch(this.database.members, memberId, { data: remote.member, server_revision: Number(remote.server_revision), table_name: tableName, is_deleted: false, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, conflict_remote: null, last_error: null, ...memberFields(remote.member, { userId: this.userId, ownerId: this.ownerId, tableName, memberId, identity: member.identity, saveState: MEMBER_SAVE_STATES.SERVER_CONFIRMED }), updated_at: now() })
      return this.getMember(memberId)
    }
    const desired = operation === MEMBER_CONFLICT_OPERATIONS.MERGED ? merged : member.data
    const payload = toServerMemberPayload(validateMemberPayload(editableMemberPayload(desired)), member.identity?.field_map)
    const tableName = remote.table_name || member.table_name; const identity = createHistoricalIdentity(member); const baseServerRevision = Number(remote.server_revision); const requestId = newId('update_member_v2', memberId)
    const fingerprint = await this.#fingerprint({ operation: 'update_member_v2', tableName, memberId, baseServerRevision, payload })
    await Promise.all(conflictMutations.map((mutation) => this.database.mutations.findOne(mutation.id).remove()))
    const nextData = mergeMemberPayload(remote.member, payload)
    await this.#patch(this.database.members, memberId, { data: nextData, server_revision: baseServerRevision, table_name: tableName, identity, is_deleted: false, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, conflict_remote: null, last_error: null, ...memberFields(nextData, { userId: this.userId, ownerId: this.ownerId, tableName, memberId, identity, saveState: MEMBER_SAVE_STATES.LOCAL_PENDING, requestId, operation: 'update_member_v2', fingerprint, baseRevision: baseServerRevision, retryCount: member.retry_count || 0 }), updated_at: now() })
    await this.#insertMutation({ id: requestId, memberId, tableName, operation: 'update_member_v2', payload, identity, baseServerRevision, fingerprint })
    this.#scheduleSync()
    return this.getMember(memberId)
  }

  async syncNow({ pullOnly = false } = {}) {
    if (!this.#isBackendReachable()) return this.getSyncState()
    if (this.syncPromise) return this.syncPromise
    this.syncPromise = this.#sync({ pullOnly }).finally(() => { this.syncPromise = null })
    return this.syncPromise
  }

  async getSyncState() {
    const sync = asJson(await this.database.sync.findOne(this.scopeKey).exec())
    const mutations = await this.database.mutations.find({ selector: { scope_key: this.scopeKey } }).exec()
    const local = mutations.map(asJson)
    const pending = local.filter((mutation) => isPendingMemberSaveState(mutation.save_state)).length
    const conflicts = local.filter((mutation) => mutation.save_state === MEMBER_SAVE_STATES.CONFLICT).length
    const failedChanges = local.filter((mutation) => mutation.save_state === MEMBER_SAVE_STATES.FAILED_RETRYABLE).length
    // The top-level harness state is an operator promise: it may say SYNCED
    // only when every durable mutation has a server confirmation.
    const offline = this.#isSimulationBlocking()
    const state = conflicts ? MEMBER_SAVE_STATES.CONFLICT
      : failedChanges ? MEMBER_SAVE_STATES.FAILED_RETRYABLE
        : offline ? (pending ? 'OFFLINE_PENDING' : 'OFFLINE')
          : pending ? 'PENDING_CHANGES'
          : (sync?.state || 'IDLE')
    return { state, cursor: sync?.cursor ?? null, pendingChanges: pending, conflicts, failedChanges, lastError: sync?.last_error || null, updatedAt: sync?.updated_at || null }
  }

  async pull() {
    if (this.#isSimulationBlocking()) return asJson(await this.database.sync.findOne(this.scopeKey).exec())?.cursor ?? null
    let checkpoint = asJson(await this.database.sync.findOne(this.scopeKey).exec())?.cursor ?? null
    let hasMore = true
    while (hasMore) {
      if (this.#isSimulationBlocking()) break
      const { data, error } = await this.supabase.rpc('pull_workspace_member_changes_v2', { p_owner_id: this.ownerId, p_after_server_revision: checkpoint, p_limit: PULL_LIMIT })
      if (error) throw error
      for (const change of data?.changes || []) await this.#applyServerChange(change)
      checkpoint = data?.next_cursor ?? checkpoint
      await this.#setSync({ cursor: checkpoint, state: 'PULLING', last_error: null })
      hasMore = Boolean(data?.has_more)
    }
    return checkpoint
  }

  async #sync({ pullOnly }) {
    if (!this.#isBackendReachable()) return this.getSyncState()
    await this.#setSync({ state: pullOnly ? 'PULLING' : 'SYNCING', last_error: null })
    try {
      if (!pullOnly) await this.#pushPending()
      await this.pull()
      await this.#setSync({ state: 'SYNCED', last_error: null })
    } catch (error) {
      await this.#setSync({ state: 'FAILED_RETRYABLE', last_error: error?.message || 'Member synchronization failed.' })
    }
    return this.getSyncState()
  }

  async #pushPending() {
    const mutations = await this.database.mutations.find({ selector: { scope_key: this.scopeKey, save_state: { $in: [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE] } } }).exec()
    const batch = mutations.map(asJson).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, this.batchSize)
    for (const mutation of batch) await this.#pushMutation(mutation)
  }

  async #pushMutation(mutation) {
    if (!this.#isBackendReachable()) return
    // A preceding local edit for this member can be confirmed while this
    // batch is being processed. Always use the durable, rebased mutation row
    // so a later edit does not submit an obsolete revision/fingerprint pair.
    const currentMutation = asJson(await this.database.mutations.findOne(mutation.id).exec())
    if (!currentMutation || !isPendingMemberSaveState(currentMutation.save_state)) return
    mutation = currentMutation
    const member = await this.getMember(mutation.member_id)
    if (!member) return
    const baseServerRevision = mutation.operation === 'create_member_v2' ? null : (mutation.base_server_revision || member.server_revision)
    if (mutation.operation === 'update_member_v2' && !baseServerRevision) {
      await this.#failMutation(mutation, 'Member creation is awaiting server confirmation.')
      return
    }
    await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.SYNCING, last_error: null, updated_at: now(), base_server_revision: baseServerRevision })
    await this.#patch(this.database.members, mutation.member_id, { save_state: MEMBER_SAVE_STATES.SYNCING, local_save_state: MEMBER_SAVE_STATES.SYNCING, last_error: null, updated_at: now() })
    if (!this.#isBackendReachable()) {
      await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: now() })
      await this.#patch(this.database.members, mutation.member_id, { save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, local_save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: now() })
      return
    }
    const fingerprint = mutation.payload_fingerprint || await this.#fingerprint({ operation: mutation.operation, tableName: mutation.table_name, memberId: mutation.member_id, baseServerRevision, payload: mutation.payload })
    const args = mutation.operation === 'create_member_v2'
      ? { p_table_name: mutation.table_name, p_owner_id: this.ownerId, p_member_id: mutation.member_id, p_member: mutation.payload, p_request_id: mutation.id, p_payload_fingerprint: fingerprint }
      : mutation.operation === 'delete_member_v2'
        ? { p_table_name: mutation.table_name, p_owner_id: this.ownerId, p_member_id: mutation.member_id, p_base_server_revision: baseServerRevision, p_request_id: mutation.id, p_payload_fingerprint: fingerprint }
        : { p_table_name: mutation.table_name, p_owner_id: this.ownerId, p_member_id: mutation.member_id, p_updates: mutation.payload, p_base_server_revision: baseServerRevision, p_request_id: mutation.id, p_payload_fingerprint: fingerprint, p_identity: mutation.identity || {} }
    const { data, error } = await this.supabase.rpc(mutation.operation, args)
    if (error) return this.#failMutation(mutation, error.message || 'Member save failed.')
    if (data?.status === 'CONFLICT') return this.#markConflict(mutation, data)
    if (data?.status !== 'SUCCESS' && data?.status !== 'IDEMPOTENT_REPLAY') return this.#failMutation(mutation, 'Server did not confirm this member change.')
    await this.#confirmMutation(mutation, data)
  }

  async #confirmMutation(mutation, response) {
    const current = await this.getMember(mutation.member_id)
    const canonical = response.member || current.data
    const revision = Number(response.server_revision || current.server_revision)
    await this.database.mutations.findOne(mutation.id).remove()
    if (mutation.operation === 'delete_member_v2') {
      await this.#patch(this.database.members, mutation.member_id, { is_deleted: true, server_revision: revision, table_name: response.table_name || current.table_name, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, conflict_remote: null, last_error: null, ...memberFields(canonical, { userId: this.userId, ownerId: this.ownerId, tableName: response.table_name || current.table_name, memberId: mutation.member_id, identity: current.identity, saveState: MEMBER_SAVE_STATES.SERVER_CONFIRMED, baseRevision: revision }), updated_at: now() })
      return
    }
    const remaining = await this.#mutationsForMember(mutation.member_id, [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE, MEMBER_SAVE_STATES.SYNCING])
    const rebasedRemaining = []
    for (const next of remaining) {
      if (next.operation !== 'update_member_v2') {
        rebasedRemaining.push(next)
        continue
      }
      // The RPC fingerprints the base revision. This mutation has not reached
      // the server yet, so rebase it without changing its durable request ID.
      const payloadFingerprint = await this.#fingerprint({ operation: next.operation, tableName: next.table_name, memberId: next.member_id, baseServerRevision: revision, payload: next.payload })
      const rebased = { ...next, base_server_revision: revision, payload_fingerprint: payloadFingerprint, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING }
      await this.#patch(this.database.mutations, next.id, { base_server_revision: revision, payload_fingerprint: payloadFingerprint, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: now() })
      rebasedRemaining.push(rebased)
    }
    const overlay = rebasedRemaining.filter((entry) => entry.operation === 'update_member_v2').reduce((data, entry) => mergeMemberPayload(data, entry.payload), canonical)
    const nextState = rebasedRemaining.length ? MEMBER_SAVE_STATES.LOCAL_PENDING : MEMBER_SAVE_STATES.SERVER_CONFIRMED
    await this.#patch(this.database.members, mutation.member_id, { data: overlay, server_revision: revision, table_name: response.table_name || current.table_name, is_deleted: false, save_state: nextState, conflict_remote: null, last_error: null, ...memberFields(overlay, { userId: this.userId, ownerId: this.ownerId, tableName: response.table_name || current.table_name, memberId: mutation.member_id, identity: current.identity, saveState: nextState, requestId: rebasedRemaining[0]?.id || null, operation: rebasedRemaining[0]?.operation || null, fingerprint: rebasedRemaining[0]?.payload_fingerprint || null, baseRevision: rebasedRemaining[0]?.base_server_revision ?? revision, retryCount: current.retry_count || 0 }), updated_at: now() })
  }

  async #failMutation(mutation, message) {
    const retryCount = (mutation.retry_count || 0) + 1
    await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, retry_count: retryCount, last_error: message, updated_at: now() })
    await this.#patch(this.database.members, mutation.member_id, { save_state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, local_save_state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, retry_count: retryCount, last_error: message, updated_at: now() })
  }

  async #markConflict(mutation, response) {
    await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.CONFLICT, last_error: 'The server has a newer member revision.', updated_at: now() })
    await this.#patch(this.database.members, mutation.member_id, { save_state: MEMBER_SAVE_STATES.CONFLICT, local_save_state: MEMBER_SAVE_STATES.CONFLICT, conflict_remote: response, remote_conflict_snapshot: response, last_error: 'The server has a newer member revision.', updated_at: now() })
  }

  async #applyServerChange(change) {
    const id = String(change.member_id); const existing = await this.getMember(id)
    const pending = await this.#mutationsForMember(id, [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE, MEMBER_SAVE_STATES.SYNCING, MEMBER_SAVE_STATES.CONFLICT])
    if (existing && pending.length) return
    const record = serverDocument({ scopeKey: this.scopeKey, userId: this.userId, ownerId: this.ownerId, change, prior: existing })
    if (existing) await this.#patch(this.database.members, id, record)
    else await this.database.members.insert(record)
  }

  async #insertMutation({ id, memberId, tableName, operation, payload, identity, baseServerRevision, fingerprint }) {
    const timestamp = now()
    await this.database.mutations.insert({ id, scope_key: this.scopeKey, member_id: memberId, table_name: tableName, owner_id: this.ownerId, operation, payload, identity, base_server_revision: baseServerRevision, payload_fingerprint: fingerprint, retry_count: 0, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, last_error: null, created_at: timestamp, updated_at: timestamp })
  }

  #fingerprint({ operation, tableName, memberId, baseServerRevision, payload }) {
    return createMemberV2Fingerprint({ operation, ownerId: this.ownerId, tableName, memberId, baseServerRevision, payload })
  }

  async #mutationsForMember(memberId, states) {
    const docs = await this.database.mutations.find({ selector: { scope_key: this.scopeKey, member_id: memberId, save_state: { $in: states } } }).exec()
    return docs.map(asJson).sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  async #patch(collection, id, values) {
    const document = await collection.findOne(id).exec()
    if (document) await document.incrementalPatch(values)
  }

  async #syncDocument() {
    const existing = await this.database.sync.findOne(this.scopeKey).exec()
    if (!existing) await this.database.sync.insert({ id: this.scopeKey, cursor: null, state: 'IDLE', last_error: null, updated_at: now() })
  }

  async #setSync({ cursor, state, last_error }) {
    const doc = await this.database.sync.findOne(this.scopeKey).exec()
    await doc.incrementalPatch({ ...(cursor === undefined ? {} : { cursor }), state, last_error, updated_at: now() })
  }

  #scheduleSync() {
    if (this.#isBackendReachable()) queueMicrotask(() => { void this.syncNow() })
  }

  #subscribeRealtime() {
    if (this.#isSimulationBlocking() || !this.supabase.channel || this.channel) return
    // Filtered joins can report SUBSCRIBED without registering in the local Realtime stack.
    // RLS remains the row-access boundary; this owner check limits wake-ups to this scope.
    this.channel = this.supabase.channel(`member-v2-signal:${this.ownerId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals' }, (payload) => {
        if (payload?.new?.owner_id !== this.ownerId) return
        traceMemberV2Realtime({
          stage: 'member-v2-realtime-signal-received',
          latestServerRevision: payload?.new?.latest_server_revision ?? null,
        })
        if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
        this.realtimeTimer = setTimeout(async () => {
          this.realtimeTimer = null
          traceMemberV2Realtime({ stage: 'member-v2-realtime-pull-started' })
          const sync = await this.syncNow({ pullOnly: true })
          traceMemberV2Realtime({ stage: 'member-v2-realtime-pull-finished', cursor: sync?.cursor ?? null, state: sync?.state || null })
        }, this.realtimeDebounceMs)
      }).subscribe((status) => {
        traceMemberV2Realtime({ stage: 'member-v2-realtime-channel-status', status })
      })
  }

  async #unsubscribeRealtime() {
    if (!this.channel) return
    const channel = this.channel; this.channel = null
    await this.supabase.removeChannel?.(channel)
  }

  #queueConnectivityChange() {
    this.connectivityChangePromise = this.connectivityChangePromise
      .catch(() => {})
      .then(() => this.#handleConnectivityChange())
    return this.connectivityChangePromise
  }

  async #handleConnectivityChange() {
    if (!this.#isBackendReachable()) return this.#unsubscribeRealtime()
    await this.#waitForRealtimeDisconnect()
    if (!this.#isBackendReachable()) return this.#unsubscribeRealtime()
    this.#subscribeRealtime()
    await this.syncNow()
  }

  async #waitForRealtimeDisconnect() {
    const isDisconnecting = this.supabase.realtime?.isDisconnecting
    while (isDisconnecting?.call(this.supabase.realtime)) {
      // realtime-js may resolve removeChannel before its socket has completed
      // disconnecting. Yield to its observable state transition before connect().
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  #isBackendReachable() {
    return this.connectivity?.isBackendReachable?.() ?? this.online()
  }

  #isSimulationBlocking() {
    return Boolean(this.connectivity) && !this.#isBackendReachable()
  }

  #assertBackendReachable() {
    if (this.#isSimulationBlocking()) throw new Error('Member V2 backend calls are blocked by offline simulation.')
  }
}

export const createMemberService = (options) => MemberService.create(options)
