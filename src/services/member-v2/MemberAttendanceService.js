import { createMemberV2AttendanceDatabase } from '../../data/member-v2/rxdb/createMemberV2AttendanceDatabase'
import { createMemberV2ScopeKey } from '../../data/member-v2/rxdb/createMemberV2Database'
import { createMemberV2AttendanceFingerprint } from '../../experiments/rxdb-member-phase1/attendanceContractFingerprint'
import { MEMBER_SAVE_STATES, isPendingMemberSaveState } from './memberSaveState'

// Keep queue ordering deterministic when a rapid P → A → Clear sequence is
// created within one clock millisecond.
let lastTimestampMs = 0
const now = () => {
  lastTimestampMs = Math.max(Date.now(), lastTimestampMs + 1)
  return new Date(lastTimestampMs).toISOString()
}
const asJson = (doc) => doc?.toJSON?.() || doc
const onlineByDefault = () => typeof navigator === 'undefined' || navigator.onLine !== false
const recordId = ({ ownerId, memberId, attendanceDate }) => `${ownerId}:${memberId}:${attendanceDate}`
const mutationId = (memberId) => `member_v2_attendance:${memberId}:${globalThis.crypto.randomUUID()}`
const validStatus = (status) => status === null || status === 'Present' || status === 'Absent'

export class MemberAttendanceService {
  constructor({ supabase, userId, ownerId, database, online = onlineByDefault, connectivity = null, canPushMutation = null, closeDatabase = false, realtimeDebounceMs = 350 }) {
    if (!supabase?.rpc || !userId || !ownerId || !database) throw new Error('Member V2 attendance requires an authenticated local workspace.')
    this.supabase = supabase; this.userId = userId; this.ownerId = ownerId; this.database = database; this.scopeKey = createMemberV2ScopeKey({ userId, ownerId })
    this.online = online; this.connectivity = connectivity; this.canPushMutation = canPushMutation; this.closeDatabase = closeDatabase; this.realtimeDebounceMs = realtimeDebounceMs; this.channel = null; this.timer = null; this.syncPromise = null; this.connectivityUnsubscribe = null
  }

  static async create(options) { const database = options.database || await createMemberV2AttendanceDatabase(options); return new MemberAttendanceService({ ...options, database, closeDatabase: !options.database }) }
  async start() { await this.#ensureSync(); this.connectivityUnsubscribe = this.connectivity?.subscribe(() => { void this.#handleConnectivityChange() }) || null; this.#subscribeRealtime(); if (this.#isBackendReachable()) void this.syncNow(); return this }
  async stop() { if (this.timer) clearTimeout(this.timer); this.connectivityUnsubscribe?.(); this.connectivityUnsubscribe = null; await this.syncPromise?.catch(() => {}); await this.#unsubscribeRealtime(); if (this.closeDatabase) await this.database.close() }
  observeAll() { return this.database.attendance.find({ selector: { scope_key: this.scopeKey }, sort: [{ attendance_date: 'asc' }] }).$ }
  observeForMember(memberId) { return this.database.attendance.find({ selector: { scope_key: this.scopeKey, member_id: memberId, is_deleted: false }, sort: [{ attendance_date: 'asc' }] }).$ }
  async getAll() { return (await this.database.attendance.find({ selector: { scope_key: this.scopeKey }, sort: [{ attendance_date: 'asc' }] }).exec()).map(asJson) }
  async getForMember(memberId) { return (await this.database.attendance.find({ selector: { scope_key: this.scopeKey, member_id: memberId, is_deleted: false }, sort: [{ attendance_date: 'asc' }] }).exec()).map(asJson) }
  async getSyncState() {
    const sync = asJson(await this.database.sync.findOne(this.scopeKey).exec()); const mutations = (await this.database.mutations.find({ selector: { scope_key: this.scopeKey } }).exec()).map(asJson)
    const pendingChanges = mutations.filter((item) => isPendingMemberSaveState(item.save_state)).length; const conflicts = mutations.filter((item) => item.save_state === MEMBER_SAVE_STATES.CONFLICT).length
    const failedChanges = mutations.filter((item) => item.save_state === MEMBER_SAVE_STATES.FAILED_RETRYABLE).length
    const offline = this.#isSimulationBlocking()
    const state = conflicts ? MEMBER_SAVE_STATES.CONFLICT : pendingChanges ? (failedChanges ? MEMBER_SAVE_STATES.FAILED_RETRYABLE : (offline ? 'OFFLINE_PENDING' : 'PENDING_CHANGES')) : (offline ? 'OFFLINE' : (sync?.state || 'IDLE'))
    return { state, cursor: sync?.cursor ?? null, pendingChanges, conflicts, failedChanges, lastError: sync?.last_error || null, updatedAt: sync?.updated_at || null }
  }
  async saveAttendance({ memberId, tableName, attendanceDate, status }) {
    if (!memberId || !tableName || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !validStatus(status)) throw new Error('Attendance needs a member, trusted month table, Sunday, and valid status.')
    const id = recordId({ ownerId: this.ownerId, memberId, attendanceDate }); const current = asJson(await this.database.attendance.findOne(id).exec());
    if (current?.status === status && !current.is_deleted && current.save_state === MEMBER_SAVE_STATES.SERVER_CONFIRMED) return { noChange: true, attendance: current }
    const requestId = mutationId(memberId); const baseServerRevision = current?.server_revision ?? null; const operation = status === null ? 'clear_member_v2_attendance' : 'set_member_v2_attendance'; const attendanceId = current?.attendance_id || globalThis.crypto.randomUUID()
    const fingerprint = await createMemberV2AttendanceFingerprint({ operation, ownerId: this.ownerId, memberId, tableName, attendanceDate, status, baseServerRevision })
    const timestamp = now(); const local = { id, scope_key: this.scopeKey, owner_id: this.ownerId, member_id: memberId, table_name: tableName, attendance_date: attendanceDate, attendance_id: attendanceId, status, is_deleted: status === null, server_revision: baseServerRevision, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, conflict_remote: null, last_error: null, created_at: current?.created_at || timestamp, updated_at: timestamp }
    if (current) await (await this.database.attendance.findOne(id).exec()).incrementalPatch(local); else await this.database.attendance.insert(local)
    await this.database.mutations.insert({ id: requestId, scope_key: this.scopeKey, owner_id: this.ownerId, member_id: memberId, table_name: tableName, attendance_date: attendanceDate, attendance_id: attendanceId, status, base_server_revision: baseServerRevision, payload_fingerprint: fingerprint, retry_count: 0, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, last_error: null, conflict_remote: null, created_at: timestamp, updated_at: timestamp })
    if (this.#isBackendReachable()) queueMicrotask(() => { void this.syncNow() }); return { noChange: false, attendance: local, requestId }
  }
  async syncNow({ pullOnly = false } = {}) {
    if (!this.#isBackendReachable()) return this.getSyncState(); if (this.syncPromise) return this.syncPromise
    this.syncPromise = this.#sync({ pullOnly }).finally(() => { this.syncPromise = null }); return this.syncPromise
  }
  async #sync({ pullOnly }) { if (!this.#isBackendReachable()) return this.getSyncState(); await this.#setSync({ state: pullOnly ? 'PULLING' : 'SYNCING', last_error: null }); try { if (!pullOnly) await this.#pushPending(); await this.pull(); await this.#setSync({ state: 'SYNCED', last_error: null }) } catch (error) { await this.#setSync({ state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, last_error: error?.message || 'Attendance synchronization failed.' }) }; return this.getSyncState() }
  async pull() { let cursor = asJson(await this.database.sync.findOne(this.scopeKey).exec())?.cursor ?? null; if (this.#isSimulationBlocking()) return cursor; let more = true; while (more) { if (this.#isSimulationBlocking()) break; const { data, error } = await this.supabase.rpc('pull_member_v2_attendance_changes_v2', { p_owner_id: this.ownerId, p_after_server_revision: cursor, p_limit: 100 }); if (error) throw error; for (const change of data?.changes || []) await this.#applyServerChange(change); cursor = data?.next_cursor ?? cursor; await this.#setSync({ cursor, state: 'PULLING', last_error: null }); more = Boolean(data?.has_more) }; return cursor }
  async #pushPending() { const docs = (await this.database.mutations.find({ selector: { scope_key: this.scopeKey, save_state: { $in: [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE] } }, sort: [{ created_at: 'asc' }] }).exec()).map(asJson); for (const mutation of docs.slice(0, 25)) await this.#pushMutation(mutation) }
  async #pushMutation(mutation) {
    if (!this.#isBackendReachable()) return
    // Earlier writes for this same member/Sunday can rebase this mutation
    // while #pushPending is iterating its initial snapshot. Re-read the
    // durable row so we send the rebased server revision with the unchanged
    // request ID instead of manufacturing a false conflict on reconnect.
    mutation = asJson(await this.database.mutations.findOne(mutation.id).exec())
    if (!mutation || ![MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE].includes(mutation.save_state)) return
    // A profile created while offline has a durable local UUID but no trusted
    // server revision yet. Keep dependent attendance local until Member V2 has
    // confirmed the profile; never send a dangling attendance reference.
    if (this.canPushMutation && !await this.canPushMutation(mutation)) return
    const record = asJson(await this.database.attendance.findOne(recordId({ ownerId: this.ownerId, memberId: mutation.member_id, attendanceDate: mutation.attendance_date })).exec()); if (!record) return
    await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.SYNCING, last_error: null, updated_at: now() }); await this.#patch(this.database.attendance, record.id, { save_state: MEMBER_SAVE_STATES.SYNCING, last_error: null, updated_at: now() })
    if (!this.#isBackendReachable()) { await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: now() }); await this.#patch(this.database.attendance, record.id, { save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: now() }); return }
    const { data, error } = await this.supabase.rpc('save_member_v2_attendance', { p_owner_id: this.ownerId, p_member_id: mutation.member_id, p_table_name: mutation.table_name, p_attendance_date: mutation.attendance_date, p_attendance_status: mutation.status, p_attendance_id: mutation.attendance_id, p_base_server_revision: mutation.base_server_revision, p_request_id: mutation.id, p_payload_fingerprint: mutation.payload_fingerprint })
    if (data?.original_status === 'CONFLICT' || data?.status === 'CONFLICT') return this.#conflict(mutation, data)
    if (error || !data || !['SUCCESS', 'IDEMPOTENT_REPLAY'].includes(data.status)) return this.#fail(mutation, error?.message || 'Server did not confirm attendance.')
    const remaining = (await this.database.mutations.find({ selector: { scope_key: this.scopeKey, member_id: mutation.member_id, attendance_date: mutation.attendance_date, save_state: { $in: [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE, MEMBER_SAVE_STATES.SYNCING] } } }).exec()).map(asJson).filter((item) => item.id !== mutation.id)
    await (await this.database.mutations.findOne(mutation.id).exec()).remove()
    const remote = data.attendance || {}; const revision = Number(data.server_revision || record.server_revision)
    // A quick local Present → Absent → Clear sequence is still one canonical
    // attendance record. Keep its newest local intent visible and rebase each
    // queued follow-up on the server revision that was just acknowledged.
    const rebasedRemaining = []
    for (const pending of remaining) {
      // The server validates a revision-bound fingerprint before it reserves a
      // request. Rebase both values together and retain the request ID.
      const operation = pending.status === null ? 'clear_member_v2_attendance' : 'set_member_v2_attendance'
      const payloadFingerprint = await createMemberV2AttendanceFingerprint({ operation, ownerId: this.ownerId, memberId: pending.member_id, tableName: pending.table_name, attendanceDate: pending.attendance_date, status: pending.status, baseServerRevision: revision })
      const rebased = { ...pending, base_server_revision: revision, payload_fingerprint: payloadFingerprint, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING }
      await this.#patch(this.database.mutations, pending.id, { base_server_revision: revision, payload_fingerprint: payloadFingerprint, save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: now() })
      rebasedRemaining.push(rebased)
    }
    const nextMutation = rebasedRemaining.at(-1)
    await this.#patch(this.database.attendance, record.id, { attendance_id: remote.attendance_id || record.attendance_id, table_name: remote.table_name || record.table_name, status: nextMutation ? nextMutation.status : remote.status, is_deleted: nextMutation ? nextMutation.status === null : Boolean(remote.is_deleted), server_revision: revision, save_state: nextMutation ? MEMBER_SAVE_STATES.LOCAL_PENDING : MEMBER_SAVE_STATES.SERVER_CONFIRMED, conflict_remote: null, last_error: null, updated_at: now() })
  }
  async #fail(mutation, message) { const retryCount = (mutation.retry_count || 0) + 1; await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, last_error: message, retry_count: retryCount, updated_at: now() }); await this.#patch(this.database.attendance, recordId({ ownerId: this.ownerId, memberId: mutation.member_id, attendanceDate: mutation.attendance_date }), { save_state: MEMBER_SAVE_STATES.FAILED_RETRYABLE, last_error: message, updated_at: now() }) }
  async #conflict(mutation, response) { await this.#patch(this.database.mutations, mutation.id, { save_state: MEMBER_SAVE_STATES.CONFLICT, conflict_remote: response, last_error: 'The server has a newer attendance revision.', updated_at: now() }); await this.#patch(this.database.attendance, recordId({ ownerId: this.ownerId, memberId: mutation.member_id, attendanceDate: mutation.attendance_date }), { save_state: MEMBER_SAVE_STATES.CONFLICT, conflict_remote: response, last_error: 'The server has a newer attendance revision.', updated_at: now() }) }
  async #applyServerChange(change) { const id = recordId({ ownerId: this.ownerId, memberId: String(change.member_id), attendanceDate: change.attendance_date }); const pending = await this.database.mutations.find({ selector: { scope_key: this.scopeKey, member_id: String(change.member_id), attendance_date: change.attendance_date, save_state: { $in: [MEMBER_SAVE_STATES.LOCAL_PENDING, MEMBER_SAVE_STATES.FAILED_RETRYABLE, MEMBER_SAVE_STATES.SYNCING, MEMBER_SAVE_STATES.CONFLICT] } } }).exec(); if (pending.length) return; const existing = await this.database.attendance.findOne(id).exec(); const record = { id, scope_key: this.scopeKey, owner_id: this.ownerId, member_id: String(change.member_id), table_name: change.table_name, attendance_date: change.attendance_date, attendance_id: change.attendance_id, status: change.status, is_deleted: Boolean(change.is_deleted), server_revision: Number(change.server_revision), save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, conflict_remote: null, last_error: null, created_at: existing ? asJson(existing).created_at : change.changed_at || now(), updated_at: change.changed_at || now() }; if (existing) await existing.incrementalPatch(record); else await this.database.attendance.insert(record) }
  async #ensureSync() { if (!await this.database.sync.findOne(this.scopeKey).exec()) await this.database.sync.insert({ id: this.scopeKey, cursor: null, state: 'IDLE', last_error: null, updated_at: now() }) }
  async #setSync(values) { const doc = await this.database.sync.findOne(this.scopeKey).exec(); await doc.incrementalPatch({ ...values, updated_at: now() }) }
  async #patch(collection, id, values) { const doc = await collection.findOne(id).exec(); if (doc) await doc.incrementalPatch(values) }
  #subscribeRealtime() { if (this.#isSimulationBlocking() || !this.supabase.channel || this.channel) return; this.channel = this.supabase.channel(`member-v2-attendance:${this.ownerId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_v2_attendance_realtime_signals', filter: `owner_id=eq.${this.ownerId}` }, () => { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; void this.syncNow({ pullOnly: true }) }, this.realtimeDebounceMs) }).subscribe() }
  async #unsubscribeRealtime() { if (!this.channel) return; const channel = this.channel; this.channel = null; await this.supabase.removeChannel?.(channel) }
  async #handleConnectivityChange() { if (!this.#isBackendReachable()) return this.#unsubscribeRealtime(); this.#subscribeRealtime(); await this.syncNow() }
  #isBackendReachable() { return this.connectivity?.isBackendReachable?.() ?? this.online() }
  #isSimulationBlocking() { return Boolean(this.connectivity) && !this.#isBackendReachable() }
}

export const createMemberAttendanceService = (options) => MemberAttendanceService.create(options)
