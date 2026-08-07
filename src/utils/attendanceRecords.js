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

export const getCanonicalAttendanceStatus = ({
  member,
  memberId,
  attendanceDate,
  attendanceData = {}
}) => {
  const mId = String(memberId || member?.id || '')
  if (!mId || !attendanceDate) return null

  let dateStr = ''
  if (typeof attendanceDate === 'string') {
    dateStr = attendanceDate.split('T')[0]
  } else if (attendanceDate instanceof Date && !isNaN(attendanceDate.getTime())) {
    const y = attendanceDate.getFullYear()
    const m = String(attendanceDate.getMonth() + 1).padStart(2, '0')
    const d = String(attendanceDate.getDate()).padStart(2, '0')
    dateStr = `${y}-${m}-${d}`
  }

  if (!dateStr) return null

  // 1. Check attendanceData map for dateStr and mId
  const dateMap = attendanceData[dateStr]
  if (dateMap && Object.prototype.hasOwnProperty.call(dateMap, mId)) {
    const mapVal = dateMap[mId]
    if (mapVal === 'Present' || mapVal === true) return 'Present'
    if (mapVal === 'Absent' || mapVal === false) return 'Absent'
  }

  // 2. Check member record columns (e.g. attendance_2026_08_02, Attendance 2nd)
  if (member && typeof member === 'object') {
    const normalizedDateKey = dateStr.replace(/-/g, '_')
    const newCol = `attendance_${normalizedDateKey}`
    const legacyCol = getLegacyAttendanceColumnName(dateStr)

    for (const key in member) {
      const keyLower = key.toLowerCase()
      if (keyLower === newCol || (legacyCol && key === legacyCol)) {
        const val = member[key]
        if (val === 'Present' || val === true) return 'Present'
        if (val === 'Absent' || val === false) return 'Absent'
      }
    }
  }

  return null
}

export const isMemberMarkedForDate = (member, attendanceDate, attendanceData) => {
  const status = getCanonicalAttendanceStatus({
    member,
    memberId: member?.id,
    attendanceDate,
    attendanceData
  })
  return status === 'Present' || status === 'Absent'
}

export const resolveMemberAttendanceForDate = (
  member,
  dateKey,
  attendanceMap = {},
  options = {}
) => {
  void options
  const status = getCanonicalAttendanceStatus({
    member,
    memberId: member?.id,
    attendanceDate: dateKey,
    attendanceData: { [dateKey]: attendanceMap }
  })
  if (status === 'Present') return true
  if (status === 'Absent') return false
  return undefined
}
