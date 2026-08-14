// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_CONVENTIONS,
  ATTENDANCE_STATUS,
  attendanceColumnNameForDate,
  formatDateKey,
  getSundaysForMonth,
  interpretAttendanceMark,
  mapAttendanceColumns,
  missingMonthsInYear,
  monthKeyFromDate,
  monthKeyFromTableName,
  monthKeyLabel,
  monthName,
  monthTableExists,
  monthTablesInYear,
  monthYearFromKey,
  normalizeMarkToken,
  parseMonthKey,
  resolveAttendanceEntries
} from './paperScanAttendance'

const sundayKeys = (monthKey) => getSundaysForMonth(monthKey).map(formatDateKey)

describe('paperScanAttendance sunday mapping', () => {
  it('lists every Sunday of a month without leaking into neighbours', () => {
    // August 2026: Sundays 2, 9, 16, 23, 30
    expect(sundayKeys('2026-08')).toEqual(['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30'])
    // The month's last Sunday never spills into September, even with 6 columns.
    const columns = mapAttendanceColumns({ month: '2026-08', columnCount: 6 })
    expect(columns.filter((col) => col.dateKey).length).toBe(5)
    expect(columns.find((col) => col.dateKey === '2026-08-30').unused).toBe(false)
    expect(columns[5].unused).toBe(true)
  })

  it('handles a month whose first Sunday is the 1st (March 2028)', () => {
    // March 2028: Sundays 5, 12, 19, 26
    expect(sundayKeys('2028-03')[0]).toBe('2028-03-05')
  })

  it('returns an empty list for an invalid month key', () => {
    expect(getSundaysForMonth('2026-13')).toEqual([])
    expect(getSundaysForMonth('garbage')).toEqual([])
    expect(getSundaysForMonth('')).toEqual([])
  })
})

describe('paperScanAttendance month key helpers', () => {
  it('parses only strict YYYY-MM keys', () => {
    expect(parseMonthKey('2026-08')).toEqual({ year: 2026, month: 7 })
    expect(parseMonthKey('2026-08-02')).toEqual({ year: null, month: null })
    expect(parseMonthKey('August 2026')).toEqual({ year: null, month: null })
    expect(parseMonthKey('2026-00')).toEqual({ year: null, month: null })
  })

  it('round-trips dates into date keys and month keys', () => {
    const date = new Date(2026, 7, 2)
    expect(formatDateKey(date)).toBe('2026-08-02')
    expect(monthKeyFromDate(date)).toBe('2026-08')
    expect(formatDateKey(null)).toBe('')
    expect(monthKeyFromDate(new Date('not-a-date'))).toBe('')
  })

  it('converts monthly table names into month keys', () => {
    expect(monthKeyFromTableName('August_2026')).toBe('2026-08')
    expect(monthKeyFromTableName('2026_08')).toBe('2026-08')
    expect(monthKeyFromTableName('2026-08')).toBe('2026-08')
    expect(monthKeyFromTableName('june-2026')).toBe('2026-06')
    expect(monthKeyFromTableName('not a table')).toBe('')
    expect(monthKeyFromTableName('')).toBe('')
  })

  it('labels month keys and extracts their year', () => {
    expect(monthName(7)).toBe('August')
    expect(monthName(12)).toBe('')
    expect(monthKeyLabel('2026-08')).toBe('August 2026')
    expect(monthKeyLabel('2026-00')).toBe('')
    expect(monthKeyLabel('garbage')).toBe('')
    expect(monthYearFromKey('2026-08')).toBe(2026)
    expect(monthYearFromKey('')).toBe(null)
  })

  it('lists existing month tables for a year and detects missing months', () => {
    const tables = ['March_2026', 'January_2026', 'August_2026', 'March_2027', 'not a table']
    expect(monthTablesInYear(tables, 2026)).toEqual(['January_2026', 'March_2026', 'August_2026'])
    expect(monthTablesInYear(tables, 2027)).toEqual(['March_2027'])
    expect(monthTablesInYear(tables, 2030)).toEqual([])
    expect(monthTableExists(tables, '2026-08')).toBe(true)
    expect(monthTableExists(tables, '2026-02')).toBe(false)
    expect(monthTableExists(tables, '')).toBe(false)
    expect(missingMonthsInYear(tables, 2026)).toEqual(['2026-02', '2026-04', '2026-05', '2026-06', '2026-07', '2026-09', '2026-10', '2026-11', '2026-12'])
    expect(missingMonthsInYear(tables, null)).toEqual([])
  })
})

describe('paperScanAttendance column mapping', () => {
  it('maps columns 1..6 to Sunday slots of August 2026', () => {
    const columns = mapAttendanceColumns({ month: '2026-08', columnCount: 6 })
    expect(columns).toHaveLength(6)
    expect(columns[0]).toEqual({ column: 1, dateKey: '2026-08-02', unused: false })
    expect(columns[4].dateKey).toBe('2026-08-30')
    expect(columns[5]).toEqual({ column: 6, dateKey: null, unused: true })
  })

  it('caps absurd column counts and tolerates zero', () => {
    expect(mapAttendanceColumns({ month: '2026-08', columnCount: 99 })).toHaveLength(12)
    expect(mapAttendanceColumns({ month: '2026-08', columnCount: 0 })).toEqual([])
    expect(mapAttendanceColumns({ month: 'garbage', columnCount: 5 })).toEqual([])
  })
})

describe('paperScanAttendance mark interpretation', () => {
  it('interprets tick/x marks under tick_x convention', () => {
    expect(interpretAttendanceMark({ rawMark: '✓', convention: ATTENDANCE_CONVENTIONS.TICK_X })).toEqual({ status: 'Present', needsReview: false })
    expect(interpretAttendanceMark({ rawMark: 'x', convention: ATTENDANCE_CONVENTIONS.TICK_X })).toEqual({ status: 'Absent', needsReview: false })
    expect(interpretAttendanceMark({ rawMark: '/', convention: ATTENDANCE_CONVENTIONS.TICK_X })).toEqual({ status: 'Present', needsReview: false })
  })

  it('treats a blank cell in tick_x mode as needs review (ambiguous)', () => {
    expect(interpretAttendanceMark({ rawMark: '', convention: ATTENDANCE_CONVENTIONS.TICK_X })).toEqual({ status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true })
  })

  it('interprets tick/blank marks under tick_blank convention', () => {
    expect(interpretAttendanceMark({ rawMark: 'tick', convention: ATTENDANCE_CONVENTIONS.TICK_BLANK })).toEqual({ status: 'Present', needsReview: false })
    expect(interpretAttendanceMark({ rawMark: 'blank', convention: ATTENDANCE_CONVENTIONS.TICK_BLANK })).toEqual({ status: 'Absent', needsReview: false })
    expect(interpretAttendanceMark({ rawMark: 'x', convention: ATTENDANCE_CONVENTIONS.TICK_BLANK })).toEqual({ status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true })
  })

  it('forces ANY ambiguous or multiple mark into Needs Review regardless of convention', () => {
    for (const convention of Object.values(ATTENDANCE_CONVENTIONS)) {
      expect(interpretAttendanceMark({ rawMark: 'both', convention }).status).toBe(ATTENDANCE_STATUS.NEEDS_REVIEW)
      expect(interpretAttendanceMark({ rawMark: '?', convention }).status).toBe(ATTENDANCE_STATUS.NEEDS_REVIEW)
    }
  })

  it('always trusts explicit statuses (legacy/manual reads)', () => {
    expect(interpretAttendanceMark({ rawMark: 'Present', convention: ATTENDANCE_CONVENTIONS.TICK_X })).toEqual({ status: 'Present', needsReview: false })
    expect(interpretAttendanceMark({ rawMark: 'Absent', convention: ATTENDANCE_CONVENTIONS.TICK_BLANK })).toEqual({ status: 'Absent', needsReview: false })
  })

  it('manual convention leans on the explicit status only', () => {
    expect(interpretAttendanceMark({ rawMark: '?', status: 'Absent', convention: ATTENDANCE_CONVENTIONS.MANUAL })).toEqual({ status: 'Absent', needsReview: false })
    expect(interpretAttendanceMark({ rawMark: '✓', status: '', convention: ATTENDANCE_CONVENTIONS.MANUAL })).toEqual({ status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true })
  })
})

describe('paperScanAttendance resolution', () => {
  it('resolves column-indexed extraction entries with raw marks preserved', () => {
    const attendance = {
      1: { mark: 'tick', status: 'Present' },
      2: { mark: 'x', status: 'Absent' },
      3: { mark: 'blank', status: 'Unknown' }
    }
    const entries = resolveAttendanceEntries({ attendance, month: '2026-08', columnCount: 3, convention: ATTENDANCE_CONVENTIONS.TICK_X })
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ column: 1, dateKey: '2026-08-02', rawMark: 'tick', interpreted: { status: 'Present', needsReview: false } })
    expect(entries[1]).toMatchObject({ column: 2, dateKey: '2026-08-09', rawMark: 'x', interpreted: { status: 'Absent', needsReview: false } })
    expect(entries[2]).toMatchObject({ column: 3, dateKey: '2026-08-16', rawMark: 'blank', interpreted: { status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true } })
  })

  it('resolves legacy date-keyed entries from older saved scans', () => {
    const attendance = {
      '2026-08-02': 'Present',
      '2026-08-09': 'Unknown'
    }
    const entries = resolveAttendanceEntries({ attendance, month: '2026-08', columnCount: 2 })
    expect(entries[0]).toMatchObject({ column: 1, dateKey: '2026-08-02', rawMark: 'Present', interpreted: { status: 'Present', needsReview: false } })
    expect(entries[1]).toMatchObject({ column: 2, rawMark: 'Unknown', interpreted: { status: ATTENDANCE_STATUS.NEEDS_REVIEW, needsReview: true } })
  })

  it('keeps unused columns out of the real month', () => {
    const entries = resolveAttendanceEntries({ attendance: {}, month: '2026-08', columnCount: 6 })
    expect(entries[5]).toMatchObject({ column: 6, dateKey: null, unused: true })
  })

  it('strictly maps a 4-Sunday month without spilling into the next month', () => {
    // February 2026 has exactly 4 Sundays: Feb 1, 8, 15, 22
    const columns = mapAttendanceColumns({ month: '2026-02', columnCount: 6 })
    expect(columns).toHaveLength(6)
    expect(columns[0]).toEqual({ column: 1, dateKey: '2026-02-01', unused: false })
    expect(columns[1]).toEqual({ column: 2, dateKey: '2026-02-08', unused: false })
    expect(columns[2]).toEqual({ column: 3, dateKey: '2026-02-15', unused: false })
    expect(columns[3]).toEqual({ column: 4, dateKey: '2026-02-22', unused: false })
    expect(columns[4]).toEqual({ column: 5, dateKey: null, unused: true })
    expect(columns[5]).toEqual({ column: 6, dateKey: null, unused: true })
    // Verify none of the columns contain a March date
    const dateKeys = columns.map(c => c.dateKey).filter(Boolean)
    expect(dateKeys).toEqual(['2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22'])
    expect(dateKeys.every(d => d.startsWith('2026-02'))).toBe(true)
  })

  it('strictly maps a 5-Sunday month and isolates extra columns', () => {
    // August 2026 has exactly 5 Sundays: Aug 2, 9, 16, 23, 30
    const columns = mapAttendanceColumns({ month: '2026-08', columnCount: 6 })
    expect(columns).toHaveLength(6)
    expect(columns.slice(0, 5).map(c => c.dateKey)).toEqual([
      '2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30'
    ])
    expect(columns[5]).toEqual({ column: 6, dateKey: null, unused: true })
  })

  it('invalidates and recalculates date keys when switching months', () => {
    const rawAttendance = {
      1: { mark: 'tick', status: 'Present' },
      2: { mark: 'x', status: 'Absent' },
      5: { mark: 'tick', status: 'Present' }
    }
    // In August (5 Sundays), column 5 maps to Aug 30
    const augEntries = resolveAttendanceEntries({ attendance: rawAttendance, month: '2026-08', columnCount: 5 })
    expect(augEntries[4]).toMatchObject({ column: 5, dateKey: '2026-08-30', interpreted: { status: 'Present' } })

    // In February (4 Sundays), column 5 is unused and dateKey is null
    const febEntries = resolveAttendanceEntries({ attendance: rawAttendance, month: '2026-02', columnCount: 5 })
    expect(febEntries[4]).toMatchObject({ column: 5, dateKey: null, unused: true })
  })

  it('normalizes mark tokens consistently', () => {
    expect(normalizeMarkToken('✓')).toBe('tick')
    expect(normalizeMarkToken('X')).toBe('x')
    expect(normalizeMarkToken('mixed')).toBe('multiple')
    expect(normalizeMarkToken('—')).toBe('blank')
    expect(normalizeMarkToken('gibberish')).toBe('unclear')
  })
})