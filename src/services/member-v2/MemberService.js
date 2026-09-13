import { createMemberV2Fingerprint } from '../../experiments/rxdb-member-phase1/memberContractFingerprint'
import { createMemberV2Database, createMemberV2ScopeKey } from '../../data/member-v2/rxdb/createMemberV2Database'
import { MEMBER_CONFLICT_OPERATIONS, assertConflictOperation, parseConflictRemote } from './memberConflict'
import { MEMBER_SAVE_STATES, isPendingMemberSaveState } from './memberSaveState'
import { assertMemberTarget, createHistoricalIdentity, targetFromMember } from './memberTarget'
import { editableMemberPayload, mergeMemberPayload, toServerMemberPayload, validateMemberPayload } from './memberValidation'

const PULL_LIMIT = 100
const DEFAULT_BATCH_SIZE = 25
const now = () => new Date().toISOString()
const newId = (kind, memberId) => `${kind}:${memberId}:${globalThis.crypto.randomUUID()}`
const asJson = (document) => document?.toJSON?.() || document

const onlineByDefault = () => typeof navigator === 'undefined' || navigator.onLine !== false

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
  constructor({ supabase, userId, ownerId, database, online = onlineByDefault, batchSize = DEFAULT_BATCH_SIZE, realtimeDebounceMs = 350, closeDatabase = false }) {
    if (!supabase?.rpc) throw new Error('Member V2 requires an authenticated Supabase client.')
    if (!userId || !ownerId || !database) throw new Error('Member V2 requires an authenticated user, workspace owner, and local database.')
    this.supabase = supabase; this.userId = userId; this.ownerId = ownerId; this.database = database
    this.scopeKey = createMemberV2ScopeKey({ userId, ownerId }); this.online = online; this.batchSize = Math.min(Math.max(batchSize, 1), DEFAULT_BATCH_SIZE)
    this.realtimeDebounceMs = realtimeDebounceMs; this.closeDatabase = closeDatabase; this.channel = null; this.realtimeTimer = null; this.syncPromise = null
  }

  static async create(options) {
    const database = options.database || await createMemberV2Database(options)
    return new MemberService({ ...options, database, closeDatabase: !options.database })
  }

  async start() {
    await this.#syncDocument()
    this.#subscribeRealtime()
    if (this.online()) void this.syncNow()
    return this
  }

  async stop() {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
    if (this.channel) await this.supabase.removeChannel(this.channel)
    this.channel = null
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
    if (!this.online()) return this.getSyncState()
    if (this.syncPromise) return this.syncPromise
    this.syncPromise = this.#sync({ pullOnly }).finally(() => { this.syncPromise = null })
    return this.syncPromise
  }

  async getSyncState() {
    const sync = asJson(await this.database.sync.findOne(this.scopeKey).exec())
    const mutations = await this.database.mutations.find({ selector: { scope_key: this.scopeKey } }).exec()
    const pending = mutations.map(asJson).filter((mutation) => isPendingMemberSaveState(mutation.save_state)).length
    const conflicts = mutations.map(asJson).filter((mutation) => mutation.save_state === MEMBER_SAVE_STATES.CONFLICT).length
    return { state: sync?.state || 'IDLE', cursor: sync?.cursor ?? null, pendingChanges: pending, conflicts, lastError: sync?.last_error || null, updatedAt: sync?.updated_at || null }
  }

  async pull() {
    let checkpoint = asJson(await this.database.sync.findOne(this.scopeKey).exec())?.cursor ?? null
    let hasMore = true
    while (hasMore) {
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
    const member = await this.getMember(mutation.member_id)
    if (!member) return
    const baseServerRevision = mutation.operation === 'create_member_v2' ? null : (mutation.base_server_revision || member.server_revision)
    if (mutation.operation === 'update_member_v2' && !baseServerRevision) {
      await this.#failMutation(mutation, 'Member creation is awaiting server confirmation.')
      return
    }
    await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.SYNCING, last_error: null, updated_at: now(), base_server_revision: baseServerRevision })
    await this.#patch(this.database.members, mutation.member_id, { save_state: MEMBER_SAVE_STATES.SYNCING, local_save_state: MEMBER_SAVE_STATES.SYNCING, last_error: null, updated_at: now() })
    const fingerprint = mutation.payload_fingerprint || await this.#fingerprint({ operation: mutation.operation, tableName: mutation.table_name, memberId: mutation.member_id, baseServerRevision, payload: mutation.payload })
    const args = mutation.operation === 'create_member_v2'
      ? { p_table_name: mutation.table_name, p_owner_id: this.ownerId, p_member_id: mutation.member_id, p_member: mutation.payload, p_request_id: mutation.id, p_payload_fingerprint: fingerprint }
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
    const remaining = await this.#mutationsForMember(mutation.member_id, [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE, MEMBER_SAVE_STATES.SYNCING])
    for (const next of remaining) {
      if (next.operation === 'update_member_v2') await this.#patch(this.database.mutations, next.id, { base_server_revision: revision, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: now() })
    }
    const overlay = remaining.filter((entry) => entry.operation === 'update_member_v2').reduce((data, entry) => mergeMemberPayload(data, entry.payload), canonical)
    const nextState = remaining.length ? MEMBER_SAVE_STATES.LOCAL_PENDING : MEMBER_SAVE_STATES.SERVER_CONFIRMED
    await this.#patch(this.database.members, mutation.member_id, { data: overlay, server_revision: revision, table_name: response.table_name || current.table_name, is_deleted: false, save_state: nextState, conflict_remote: null, last_error: null, ...memberFields(overlay, { userId: this.userId, ownerId: this.ownerId, tableName: response.table_name || current.table_name, memberId: mutation.member_id, identity: current.identity, saveState: nextState, requestId: remaining[0]?.id || null, operation: remaining[0]?.operation || null, fingerprint: remaining[0]?.payload_fingerprint || null, baseRevision: remaining[0]?.base_server_revision ?? revision, retryCount: current.retry_count || 0 }), updated_at: now() })
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
    if (this.online()) queueMicrotask(() => { void this.syncNow() })
  }

  #subscribeRealtime() {
    if (!this.supabase.channel || this.channel) return
    this.channel = this.supabase.channel(`member-v2-signal:${this.ownerId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals', filter: `owner_id=eq.${this.ownerId}` }, () => {
        if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
        this.realtimeTimer = setTimeout(() => { this.realtimeTimer = null; void this.syncNow({ pullOnly: true }) }, this.realtimeDebounceMs)
      }).subscribe()
  }
}

export const createMemberService = (options) => MemberService.create(options)
