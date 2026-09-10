const identity = (member) => member

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

export const reconcileAuthoritativeMemberSnapshot = (remoteMembers, pendingChanges, tableName, normalizeMember = identity) => (
  applyPendingChangesToMemberSnapshot(remoteMembers, pendingChanges, tableName, normalizeMember)
)
