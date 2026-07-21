const sameText = (left, right) => String(left ?? '') === String(right ?? '')

const attendanceColumnForDate = (serviceDate) => {
  const match = String(serviceDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `attendance_${match[1]}_${match[2]}_${match[3]}` : null
}

const pendingForMember = (pendingChanges, member, tableName) => (
  (Array.isArray(pendingChanges) ? pendingChanges : []).filter((change) => (
    sameText(change?.member_id, member?.id) &&
    (!change?.table_name || !tableName || sameText(change.table_name, tableName)) &&
    ['pending', 'waiting_for_month', 'syncing', 'conflict', 'failed'].includes(change?.sync_status || 'pending')
  ))
)

export const mergeRealtimeMemberWithPending = (incoming, pendingChanges, tableName) => {
  if (!incoming?.id) return { member: incoming, shouldRemove: false, pendingCount: 0 }

  const changes = pendingForMember(pendingChanges, incoming, tableName)
    .sort((left, right) => String(left?.updated_at || left?.created_at || '').localeCompare(String(right?.updated_at || right?.created_at || '')))

  let member = { ...incoming }
  let shouldRemove = false

  changes.forEach((change) => {
    if (change.action_type === 'member_delete') {
      shouldRemove = true
      return
    }

    if (change.action_type === 'member_update' || change.action_type === 'member_add') {
      member = { ...member, ...(change.updates || change.payload || {}) }
    }

    if (change.action_type === 'attendance_mark' || change.action_type === 'bulk_attendance_mark') {
      const columnName = attendanceColumnForDate(change.service_date || change.session_id)
      if (columnName) {
        member[columnName] = change.present === null || change.attendance_status === 'unknown'
          ? null
          : (change.present === true || change.attendance_status === 'present' ? 'Present' : 'Absent')
      }
    }
  })

  if (changes.length > 0) {
    const hasPendingDelete = changes.some((change) => change.action_type === 'member_delete')
    const remoteDeletedAt = member.deleted_at || null
    if (remoteDeletedAt) {
      member.__remote_deleted_at = remoteDeletedAt
      delete member.deleted_at
    }
    member.__offline_status = remoteDeletedAt || changes.some((change) => change.sync_status === 'conflict')
      ? 'conflict'
      : 'pending_sync'
    shouldRemove = hasPendingDelete
  }

  return { member, shouldRemove, pendingCount: changes.length }
}

export const mergeAttendanceMapWithPending = (attendanceMap, pendingChanges, { tableName, serviceDate } = {}) => {
  const merged = { ...(attendanceMap || {}) }
  ;(Array.isArray(pendingChanges) ? pendingChanges : [])
    .filter((change) => (
      ['attendance_mark', 'bulk_attendance_mark'].includes(change?.action_type) &&
      sameText(change?.service_date || change?.session_id, serviceDate) &&
      (!change?.table_name || !tableName || sameText(change.table_name, tableName)) &&
      ['pending', 'waiting_for_month', 'syncing', 'conflict', 'failed'].includes(change?.sync_status || 'pending')
    ))
    .sort((left, right) => String(left?.updated_at || left?.created_at || '').localeCompare(String(right?.updated_at || right?.created_at || '')))
    .forEach((change) => {
      if (!change?.member_id) return
      if (change.present === null || change.attendance_status === 'unknown') {
        delete merged[change.member_id]
      } else {
        merged[change.member_id] = change.present === true || change.attendance_status === 'present'
      }
    })
  return merged
}
