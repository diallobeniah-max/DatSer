// Month-specific attendance mapping for Paper Scan Review.
//
// Attendance columns 1-N are Sunday slots of ONE selected month: column N is
// the Nth Sunday of that month. Extra boxes are UNMAPPED / UNUSED and never leak
// into adjacent months. Everything here is pure and node-safe so it runs in
// Vitest and the browser identically.
//
// Evidence preservation: the raw Gemini mark, its column number and the actual
// mapped Sunday date are always kept untouched. `interpretAttendanceMark` only
// produces an interpreted verdict on top of them; a reviewer decision is stored
// separately keyed by date so it can never carry into another month.

export const ATTENDANCE_CONVENTIONS = {
  TICK_X: 'tick_x',        // tick = Present, x = Absent, blank = needs review
  TICK_BLANK: 'tick_blank', // tick = Present, blank = Absent, x = needs review
  MANUAL: 'manual'         // rely on explicit Present/Absent reads only
}

export const ATTENDANCE_CONVENTION_OPTIONS = [
  { id: ATTENDANCE_CONVENTIONS.TICK_X, label: 'Tick = Present, X = Absent' },
  { id: ATTENDANCE_CONVENTIONS.TICK_BLANK, label: 'Tick = Present, Blank = Absent' },
  { id: ATTENDANCE_CONVENTIONS.MANUAL, label: 'Manual Review' }
]

export const ATTENDANCE_STATUS = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  UNKNOWN: 'Unknown',
  NEEDS_REVIEW: 'Needs Review'
}

const MARK_TOKENS = {
  present: ['present', 'true', 'yes', 'p'],
  absent: ['absent', 'no', 'a'],
  unknown: ['unknown', 'unclear', 'unreadable', '?'],
  tick: ['tick', 'check', 'checkmark', '✓', '✔', '/', '\\'],
  x: ['x', 'cross', '×', '✗', '✘'],
  blank: ['blank', 'none', 'empty', '-', '—', ''],
  multiple: ['multiple', 'mixed', 'both', 'tick_and_x']
}

export const normalizeMarkToken = (raw) => {
  const value = String(raw ?? '').trim().toLowerCase()
  for (const [token, candidates] of Object.entries(MARK_TOKENS)) {
    if (candidates.includes(value)) return token
  }
  return 'unclear'
}

// 'YYYY-MM' -> { year, month } with month 0-indexed; nulls for bad input.
export const parseMonthKey = (value) => {
  const normalized = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})$/.exec(normalized)
  if (!match) return { year: null, month: null }
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  if (month < 0 || month > 11) return { year: null, month: null }
  return { year, month }
}

export const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const monthKeyFromDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const MONTH_INDEX_BY_NAME = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
}

// Tolerant conversion of a monthly table name (the app's own convention) into a
// 'YYYY-MM' key: accepts '2026_08', '2026-08', 'August_2026', 'August 26'.
export const monthKeyFromTableName = (value) => {
  const normalized = String(value || '').trim()
  const numeric = /^(\d{4})[_\-\s](\d{2})$/.exec(normalized)
  if (numeric) {
    return parseMonthKey(`${numeric[1]}-${numeric[2]}`).year ? `${numeric[1]}-${numeric[2]}` : ''
  }
  const named = /^([A-Za-z]+)[_\-\s](\d{4})$/.exec(normalized)
  if (named) {
    const month = MONTH_INDEX_BY_NAME[named[1].toLowerCase()]
    if (month !== undefined) return `${named[2]}-${String(month + 1).padStart(2, '0')}`
  }
  return ''
}

// All Sundays of `monthKey` in local time, in order.
export const getSundaysForMonth = (monthKey) => {
  const { year, month } = parseMonthKey(monthKey)
  if (!year || month === null) return []
  const sundays = []
  const cursor = new Date(year, month, 1)
  while (cursor.getDay() !== 0) cursor.setDate(cursor.getDate() + 1)
  while (cursor.getMonth() === month) {
    sundays.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()))
    cursor.setDate(cursor.getDate() + 7)
  }
  return sundays
}

// Collects every Sunday across one or more selected months for the Final Review
// table. Only explicitly selected dates belong in `selectedSet`; every other
// Sunday is still returned in `dates` so the UI can render it greyed out.
export const collectMonthSundays = (months, sundaysByMonth = {}) => {
  const dates = []
  const seen = new Set()
  const selectedSet = new Set()
  ;(Array.isArray(months) ? months : []).forEach((month) => {
    const selected = Array.isArray(sundaysByMonth?.[month]) ? sundaysByMonth[month] : []
    ;(selected || []).forEach((dateKey) => {
      if (dateKey) selectedSet.add(dateKey)
    })
    getSundaysForMonth(month).forEach((date) => {
      const dateKey = formatDateKey(date)
      if (dateKey && !seen.has(dateKey)) {
        seen.add(dateKey)
        dates.push(dateKey)
      }
    })
  })
  dates.sort()
  return { dates, selectedSet }
}

// Maps attendance columns to the Sundays of `month`. Columns beyond the month's
// real Sunday count get `unused: true` and a null date — they are never pushed
// into the adjacent month.
export const mapAttendanceColumns = ({ month, columnCount }) => {
  const { year } = parseMonthKey(month)
  if (!year) return []
  const sundays = getSundaysForMonth(month)
  const rawCount = Number(columnCount) || 0
  const count = Math.max(0, Math.min(rawCount, 12))
  return Array.from({ length: count }, (_, index) => {
    const date = sundays[index]
    return {
      column: index + 1,
      dateKey: date ? formatDateKey(date) : null,
      unused: !date
    }
  })
}

// Interprets one raw sheet mark under a sheet convention. The interpreted
// result is a verdict ONLY: raw mark, column and mapped Sunday date are kept
// untouched by the caller so evidence is never destroyed.
export const interpretAttendanceMark = ({ rawMark, status, convention }) => {
  const token = normalizeMarkToken(rawMark)
  const mode = convention || ATTENDANCE_CONVENTIONS.TICK_X

  // Manual Review: the explicit Present/Absent read wins, whatever the mark.
  if (mode === ATTENDANCE_CONVENTIONS.MANUAL) {
    if (status === 'Present' || status === 'Absent') return { status, needsReview: false }
    return { status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true }
  }

  // Explicit statuses (legacy extractions / manual reads) always win.
  if (token === 'present') return { status: ATTENDANCE_STATUS.PRESENT, needsReview: false }
  if (token === 'absent') return { status: ATTENDANCE_STATUS.ABSENT, needsReview: false }
  if (token === 'unknown' || token === 'multiple') {
    return { status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true }
  }

  if (mode === ATTENDANCE_CONVENTIONS.TICK_X) {
    if (token === 'tick') return { status: ATTENDANCE_STATUS.PRESENT, needsReview: false }
    if (token === 'x') return { status: ATTENDANCE_STATUS.ABSENT, needsReview: false }
    return { status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true }
  }
  // tick_blank
  if (token === 'tick') return { status: ATTENDANCE_STATUS.PRESENT, needsReview: false }
  if (token === 'blank') return { status: ATTENDANCE_STATUS.ABSENT, needsReview: false }
  return { status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true }
}

// Resolves a row's `attendance` field into per-column slots for `month`. Accepts
// BOTH the column-indexed extraction shape { '1': { mark, status } } and the
// legacy date-keyed shape { 'YYYY-MM-DD': 'Present|Absent|Unknown' }.
export const resolveAttendanceEntries = ({ attendance, month, columnCount, convention }) => {
  const columns = mapAttendanceColumns({ month, columnCount })
  if (!columns.length) return []
  const map = attendance && typeof attendance === 'object' ? attendance : {}
  return columns.map((col) => {
    if (col.unused || !col.dateKey) {
      return {
        ...col,
        rawMark: '',
        aiStatus: '',
        markToken: 'unused',
        interpreted: { status: ATTENDANCE_STATUS.UNKNOWN, needsReview: false }
      }
    }
    const columnEntry = map[String(col.column)]
    const dateEntry = map[col.dateKey]
    const structured = columnEntry && typeof columnEntry === 'object' && !Array.isArray(columnEntry)
      ? columnEntry
      : dateEntry && typeof dateEntry === 'object' && !Array.isArray(dateEntry)
        ? dateEntry
        : null
    const legacyStatus = typeof columnEntry === 'string'
      ? columnEntry
      : (structured ? structured.status : (typeof dateEntry === 'string' ? dateEntry : ''))
    const rawMark = structured ? structured.mark : legacyStatus
    const aiStatus = legacyStatus
    const interpreted = interpretAttendanceMark({ rawMark, status: aiStatus, convention })
    return { ...col, rawMark, aiStatus, markToken: normalizeMarkToken(rawMark), interpreted }
  })
}

export const attendanceColumnNameForDate = (dateKey) => `attendance_${String(dateKey || '').replace(/-/g, '_')}`

const getLegacyAttendanceColumnName = (dateKey) => {
  if (!dateKey) return null
  const day = Number(String(dateKey).split('-')[2])
  if (!Number.isFinite(day)) return null
  return `Attendance ${day}${['st', 'nd', 'rd'][((day % 100) - 20) % 10] || 'th'}`
}

// Reads the canonical Present/Absent status stored on a member row for a date,
// supporting both the modern attendance_YYYY_MM_DD column and the legacy
// "Attendance Nth" column. Returns null when the row has no explicit mark.
export const readAttendanceStatusFromMember = (member, dateKey) => {
  if (!member || !dateKey) return null
  const column = attendanceColumnNameForDate(dateKey)
  const legacyColumn = getLegacyAttendanceColumnName(dateKey)
  const raw = member[column] ?? (legacyColumn ? member[legacyColumn] : undefined)
  if (raw === 'Present' || raw === true) return ATTENDANCE_STATUS.PRESENT
  if (raw === 'Absent' || raw === false) return ATTENDANCE_STATUS.ABSENT
  return null
}

// True only when the server row contains the EXACT status the review intended.
// Needs Review / unresolved / missing values are never treated as a match.
export const attendanceMatchesExpected = (member, dateKey, expected) => {
  if (expected !== ATTENDANCE_STATUS.PRESENT && expected !== ATTENDANCE_STATUS.ABSENT) return false
  return readAttendanceStatusFromMember(member, dateKey) === expected
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export const monthName = (monthIndex) => MONTH_NAMES[monthIndex] || ''

// '2026-08' -> 'August 2026'; '' for a bad key.
export const monthKeyLabel = (monthKey) => {
  const { year, month } = parseMonthKey(monthKey)
  if (!year || month === null) return ''
  return `${monthName(month)} ${year}`
}

export const monthYearFromKey = (monthKey) => {
  const { year } = parseMonthKey(monthKey)
  return year || null
}

// The member-table names (the app's own monthly convention) that already exist
// for a given year, sorted by month.
export const monthTablesInYear = (monthlyTables, year) => {
  const tables = Array.isArray(monthlyTables) ? monthlyTables : []
  return tables
    .map((table) => ({ table, key: monthKeyFromTableName(table) }))
    .filter(({ key }) => key && monthYearFromKey(key) === year)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ table }) => table)
}

export const monthTableExists = (monthlyTables, monthKey) => {
  if (!monthKey) return false
  return (Array.isArray(monthlyTables) ? monthlyTables : []).some((table) => monthKeyFromTableName(table) === monthKey)
}

// Month keys (of the given year) that have no member table yet, oldest first.
export const missingMonthsInYear = (monthlyTables, year) => {
  if (!year) return []
  const existing = new Set(
    (Array.isArray(monthlyTables) ? monthlyTables : [])
      .map((table) => monthKeyFromTableName(table))
      .filter((key) => key && monthYearFromKey(key) === year)
  )
  const missing = []
  for (let month = 0; month < 12; month += 1) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`
    if (!existing.has(key)) missing.push(key)
  }
  return missing
}