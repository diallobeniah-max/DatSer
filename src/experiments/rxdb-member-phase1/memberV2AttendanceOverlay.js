const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

const overlayKey = (record) => `${record.table_name}:${record.member_id}:${record.attendance_date}`

// The legacy dashboard continues to read its monthly-table attendance map while
// Member V2 is isolated. This overlay makes the durable Member V2 collection
// the final UI layer for that local-only experiment. It is intentionally a
// pure merge so every legacy refresh and realtime read can use the same rule.
export const buildMemberV2AttendanceOverlay = (records = []) => {
  const overlay = new Map()
  for (const record of records) {
    if (!record?.table_name || !record?.member_id || !validDate(record.attendance_date)) continue
    if (record.status !== 'Present' && record.status !== 'Absent' && !record.is_deleted) continue
    overlay.set(overlayKey(record), record)
  }
  return overlay
}

export const mergeMemberV2AttendanceOverlay = ({ attendanceData = {}, tableName, overlay } = {}) => {
  if (!tableName || !overlay?.size) return attendanceData

  let next = attendanceData
  for (const record of overlay.values()) {
    if (record.table_name !== tableName) continue
    const dateKey = record.attendance_date
    const memberId = String(record.member_id)
    const previousDate = next[dateKey] || {}
    const shouldDelete = Boolean(record.is_deleted) || record.status === null
    const nextValue = record.status === 'Present'

    if (shouldDelete) {
      if (!Object.prototype.hasOwnProperty.call(previousDate, memberId)) continue
      if (next === attendanceData) next = { ...attendanceData }
      const { [memberId]: _removed, ...remaining } = previousDate
      next[dateKey] = remaining
      continue
    }

    if (previousDate[memberId] === nextValue) continue
    if (next === attendanceData) next = { ...attendanceData }
    next[dateKey] = { ...previousDate, [memberId]: nextValue }
  }
  return next
}
