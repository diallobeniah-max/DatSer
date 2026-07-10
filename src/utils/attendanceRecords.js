export const getOrdinalSuffix = (day) => {
  const value = Number(day)
  if (!Number.isFinite(value)) return 'th'
  if (value % 100 >= 11 && value % 100 <= 13) return 'th'
  switch (value % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

export const normalizeAttendanceValue = (value) => {
  if (value === true || value === false) return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'present') return true
  if (normalized === 'absent') return false
  return undefined
}

export const normalizeQueuedAttendanceValue = (value) => (
  value === true || value === false ? value : null
)

export const isOfflineAttendanceConflict = (
  serverValue,
  queuedValue,
  baseValue = undefined,
  hasBaseValue = false
) => {
  const queued = normalizeQueuedAttendanceValue(queuedValue)

  // New queue entries remember what the user originally saw. A conflict only
  // exists when the server changed since that snapshot; changing Present to
  // Absent (or Clear) while offline is otherwise an intentional edit.
  if (hasBaseValue) {
    const normalizedServer = normalizeAttendanceValue(serverValue)
    const normalizedBase = normalizeQueuedAttendanceValue(baseValue)
    const serverState = typeof normalizedServer === 'boolean' ? normalizedServer : null
    return serverState !== normalizedBase
  }

  if (queued === null) return false

  const normalizedServer = normalizeAttendanceValue(serverValue)
  return typeof normalizedServer === 'boolean' && normalizedServer !== queued
}

export const isAttendanceAlreadySynced = (serverValue, queuedValue) => {
  const queued = normalizeQueuedAttendanceValue(queuedValue)
  const normalizedServer = normalizeAttendanceValue(serverValue)

  if (queued === null) return normalizedServer === undefined
  return normalizedServer === queued
}

export const getLegacyAttendanceColumnName = (dateKey) => {
  if (!dateKey) return null
  const parts = String(dateKey).split('-')
  const day = Number(parts[2])
  if (!Number.isFinite(day)) return null
  return `Attendance ${day}${getOrdinalSuffix(day)}`
}

export const resolveMemberAttendanceForDate = (member, dateKey, attendanceMap = {}) => {
  if (!member || !dateKey) return undefined

  if (Object.prototype.hasOwnProperty.call(attendanceMap, member.id)) {
    const mapValue = normalizeAttendanceValue(attendanceMap[member.id])
    if (mapValue !== undefined) return mapValue
    return undefined
  }

  const normalizedDateKey = String(dateKey).replace(/-/g, '_')
  const newColumnName = `attendance_${normalizedDateKey}`
  const legacyColumnName = getLegacyAttendanceColumnName(dateKey)

  for (const key in member) {
    const keyLower = key.toLowerCase()
    if (keyLower === newColumnName || key === legacyColumnName) {
      const memberValue = normalizeAttendanceValue(member[key])
      if (memberValue !== undefined) return memberValue
    }
  }

  return undefined
}
