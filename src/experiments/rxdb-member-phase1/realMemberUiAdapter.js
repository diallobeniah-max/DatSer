import { createMemberService } from '../../services/member-v2/MemberService'
import { createHistoricalIdentity } from '../../services/member-v2/memberTarget'
import { MEMBER_SAVE_STATES } from '../../services/member-v2/memberSaveState'
import { MEMBER_CONFLICT_OPERATIONS } from '../../services/member-v2/memberConflict'
import { updateMemberV2LocalFlowGuard } from './memberV2FeatureFlag'
import { getRealDatserMemberV2Connectivity } from './realDatserConnectivity'

let activeAdapter = null

const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

const memberForLegacyUi = (record) => ({
  ...(record?.data || {}),
  id: record?.member_id || record?.id,
  member_id: record?.member_id || record?.id,
  workspace_owner_id: record?.owner_id,
  user_id: record?.owner_id,
  source_table: record?.table_name,
  __source_table: record?.table_name,
  __canonical_member_id: record?.member_id || record?.id,
  server_revision: record?.server_revision ?? null,
  __member_v2_save_state: record?.save_state || MEMBER_SAVE_STATES.LOCAL_PENDING,
  __member_v2_error: record?.last_error || null,
  updated_at: record?.updated_at || new Date().toISOString(),
})

const stateMessage = (syncState) => {
  if (syncState.conflicts) return 'Member V2 saved locally, but it needs conflict resolution before it can sync.'
  if (syncState.failedChanges) return 'Member V2 saved locally, but retry is needed before the server confirms it.'
  if (syncState.pendingChanges) return 'Member saved locally and is waiting to sync.'
  return 'Member saved and confirmed by the server.'
}

class RealMemberUiAdapter {
  constructor({ supabase, userId, ownerId, online = browserOnline, connectivity = getRealDatserMemberV2Connectivity() }) {
    this.supabase = supabase
    this.userId = userId
    this.ownerId = ownerId
    this.online = online
    this.connectivity = connectivity
    this.service = null
    this.startPromise = null
  }

  async start() {
    if (!this.service || this.startPromise) {
      if (!this.startPromise) {
        this.startPromise = (async () => {
          this.service = await createMemberService({
            supabase: this.supabase,
            userId: this.userId,
            ownerId: this.ownerId,
            online: this.online,
            connectivity: this.connectivity,
          })
          await this.service.start()
          // MemberService starts a bounded initial pull in the background. Wait
          // here so a real edit has the server revision the trusted update RPC
          // requires before the operator can choose offline mode.
          await this.service.syncNow()
        })().finally(() => { this.startPromise = null })
      }
      await this.startPromise
    }
    await this.refreshGuard()
    return this
  }

  async stop() {
    await this.startPromise?.catch(() => {})
    await this.service?.stop()
    this.service = null
  }

  async refreshGuard() {
    const syncState = await this.service.getSyncState()
    updateMemberV2LocalFlowGuard({ userId: this.userId, ownerId: this.ownerId, syncState })
    return syncState
  }

  async listLocalMembers({ tableName, includeConfirmed = true } = {}) {
    await this.start()
    const selector = { scope_key: this.service.scopeKey }
    if (tableName) selector.table_name = tableName
    const records = await this.service.database.members.find({ selector }).exec()
    return records
      .map((record) => record.toJSON())
      .filter((record) => includeConfirmed || record.save_state !== MEMBER_SAVE_STATES.SERVER_CONFIRMED)
      .map(memberForLegacyUi)
  }

  async subscribeLocalMembers(listener) {
    await this.start()
    const subscription = this.service.observeMembers().subscribe((records) => {
      listener(records.map((record) => memberForLegacyUi(record.toJSON())))
    })
    return () => subscription.unsubscribe()
  }

  async create({ tableName, payload }) {
    await this.start()
    const local = await this.service.createMember({ tableName, member: payload })
    await this.refreshGuard()
    const syncState = await this.service.syncNow()
    const member = await this.service.getMember(local.member_id || local.id)
    await this.refreshGuard()
    return { member: memberForLegacyUi(member), syncState, message: stateMessage(syncState) }
  }

  async update({ member, tableName, updates }) {
    await this.start()
    const memberId = String(member?.__canonical_member_id || member?.member_id || member?.id || '')
    if (!memberId) throw new Error('This member has no canonical identity for Member V2.')

    // start() performs the trusted workspace pull. Do not fabricate a server
    // revision when this local device has not yet received this member.
    const local = await this.service.getMember(memberId)
    if (!local) {
      throw new Error('This member is not available in the local Member V2 snapshot yet. Connect once, reopen the member, and try again.')
    }
    const saved = await this.service.updateMember(memberId, updates, {
      tableName,
      identity: createHistoricalIdentity(local),
    })
    await this.refreshGuard()
    const syncState = await this.service.syncNow()
    const current = await this.service.getMember(saved.member_id || saved.id)
    await this.refreshGuard()
    return { member: memberForLegacyUi(current), syncState, message: stateMessage(syncState) }
  }

  async useServerConflictCopy({ member }) {
    await this.start()
    const memberId = String(member?.__canonical_member_id || member?.member_id || member?.id || '')
    if (!memberId) throw new Error('This member has no canonical identity for conflict recovery.')
    const resolved = await this.service.resolveConflict(memberId, MEMBER_CONFLICT_OPERATIONS.USE_SERVER)
    const syncState = await this.refreshGuard()
    return { member: memberForLegacyUi(resolved), syncState }
  }

  async hasConflictForMember(member) {
    await this.start()
    const memberId = String(member?.__canonical_member_id || member?.member_id || member?.id || '')
    if (!memberId) return false
    const local = await this.service.getMember(memberId)
    return local?.save_state === MEMBER_SAVE_STATES.CONFLICT
  }
}

export const getRealMemberV2UiAdapter = async ({ supabase, userId, ownerId, online, connectivity }) => {
  if (!userId || !ownerId) throw new Error('Member V2 requires an authenticated user and workspace owner.')
  const scope = `${userId}:${ownerId}`
  if (activeAdapter && activeAdapter.scope !== scope) {
    await activeAdapter.adapter.stop()
    activeAdapter = null
  }
  if (!activeAdapter) {
    activeAdapter = { scope, adapter: new RealMemberUiAdapter({ supabase, userId, ownerId, online, connectivity }) }
  }
  return activeAdapter.adapter.start()
}

export const resetRealMemberV2UiAdapterForTests = async () => {
  await activeAdapter?.adapter.stop()
  activeAdapter = null
}
