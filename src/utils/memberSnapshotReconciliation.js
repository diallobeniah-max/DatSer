const identity = (member) => member

export const removeMemberV2Tombstones = (members = [], memberV2Rows = []) => {
  const deletedIds = new Set((memberV2Rows || [])
    .filter((member) => Boolean(member?.is_deleted))
    .map((member) => String(member.id || member.member_id || member.__canonical_member_id || ''))
    .filter(Boolean))
  return deletedIds.size
    ? (members || []).filter((member) => !deletedIds.has(String(member?.id || member?.member_id || '')))
    : members
}

// A full remote snapshot is authoritative. Only a durable, still-pending
// local mutation may overlay it while that mutation awaits reconciliation.
export const applyPendingChangesToMemberSnapshot = (
  snapshotMembers = [],
  pendingChanges = [],
  tableName = null,
  normalizeMember = identity
) => {
  const byId = new Map()
  snapshotMembers.forEach((member) => {
    if (member?.id) byId.set(String(member.id), normalizeMember(member))
  })

  ;(pendingChanges || []).forEach((change) => {
    if (!change || (tableName && change.table_name && change.table_name !== tableName)) return
    const memberId = change.member_id || change.member_data?.id
    if (!memberId) return
    const key = String(memberId)

    if (change.action_type === 'member_delete') {
      byId.delete(key)
      return
    }

    if (change.action_type === 'member_add') {
      byId.set(key, normalizeMember({
        ...(byId.get(key) || {}),
        ...(change.member_data || {}),
        id: memberId,
        updated_at: change.created_at || change.timestamp || new Date().toISOString()
      }))
      return
    }

    if (change.action_type === 'member_update') {
      byId.set(key, normalizeMember({
        ...(byId.get(key) || { id: memberId }),
        ...(change.updates || {}),
        updated_at: change.created_at || change.timestamp || new Date().toISOString()
      }))
    }
  })

  return Array.from(byId.values())
}

export const reconcileAuthoritativeMemberSnapshot = (remoteMembers, pendingChanges, tableName, normalizeMember = identity) => {
  const effectiveMembers = applyPendingChangesToMemberSnapshot(remoteMembers, pendingChanges, tableName, normalizeMember)
  if (typeof window !== 'undefined' && window.__datserMemberV2IdTrace?.enabled) {
    const wantedIds = new Set((window.__datserMemberV2IdTrace.memberIds || []).map(String))
    const safeIds = (rows = []) => rows
      .map((row) => String(row?.id || row?.member_id || row?.member_data?.id || ''))
      .filter((id) => wantedIds.has(id))
    window.__datserMemberV2IdTrace.events ||= []
    window.__datserMemberV2IdTrace.events.push({
      at: new Date().toISOString(),
      stage: 'memberSnapshotReconciliation',
      tableName,
      inputIds: safeIds(remoteMembers),
      pendingOverlayIds: (pendingChanges || [])
        .filter((change) => wantedIds.has(String(change?.member_id || change?.member_data?.id || '')))
        .map((change) => ({
          memberId: String(change.member_id || change.member_data?.id),
          action: change.action_type || null,
          syncStatus: change.sync_status || null,
        })),
      outputIds: safeIds(effectiveMembers),
    })
  }
  return effectiveMembers
}
