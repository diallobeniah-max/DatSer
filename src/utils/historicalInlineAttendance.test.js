import { describe, it, expect } from 'vitest'
import {
  normalizeAttendanceStatus,
  resolveInlineAttendanceAction,
  buildHistoricalTransferSnapshot,
  ATTENDANCE_STATUS,
  INLINE_ATTENDANCE_ACTIONS
} from './historicalInlineAttendance'

describe('normalizeAttendanceStatus', () => {
  it('maps boolean false and Absent strings to Absent', () => {
    expect(normalizeAttendanceStatus(false)).toBe(ATTENDANCE_STATUS.ABSENT)
    expect(normalizeAttendanceStatus('Absent')).toBe(ATTENDANCE_STATUS.ABSENT)
    expect(normalizeAttendanceStatus('absent')).toBe(ATTENDANCE_STATUS.ABSENT)
  })

  it('maps everything else to Present', () => {
    expect(normalizeAttendanceStatus(true)).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(normalizeAttendanceStatus('Present')).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(normalizeAttendanceStatus(null)).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(normalizeAttendanceStatus(undefined)).toBe(ATTENDANCE_STATUS.PRESENT)
  })
})

describe('resolveInlineAttendanceAction', () => {
  describe('historical member not yet in current month', () => {
    it('routes Present through the cross-month transfer flow', () => {
      const decision = resolveInlineAttendanceAction({ alreadyInCurrentTable: false, nextValue: true })
      expect(decision.action).toBe(INLINE_ATTENDANCE_ACTIONS.TRANSFER)
      expect(decision.status).toBe(ATTENDANCE_STATUS.PRESENT)
    })

    it('routes Absent through the cross-month transfer flow', () => {
      const decision = resolveInlineAttendanceAction({ alreadyInCurrentTable: false, nextValue: false })
      expect(decision.action).toBe(INLINE_ATTENDANCE_ACTIONS.TRANSFER)
      expect(decision.status).toBe(ATTENDANCE_STATUS.ABSENT)
    })

    it('never routes historical Clear to a transfer (no import merely to clear)', () => {
      const decision = resolveInlineAttendanceAction({ alreadyInCurrentTable: false, nextValue: null })
      expect(decision.action).toBe(INLINE_ATTENDANCE_ACTIONS.SKIP)
    })
  })

  describe('member already in current month (or current-month member)', () => {
    it('uses the normal inline P/A/C behavior for Present', () => {
      const decision = resolveInlineAttendanceAction({ alreadyInCurrentTable: true, nextValue: true })
      expect(decision.action).toBe(INLINE_ATTENDANCE_ACTIONS.NORMAL)
    })

    it('uses the normal inline P/A/C behavior for Absent', () => {
      const decision = resolveInlineAttendanceAction({ alreadyInCurrentTable: true, nextValue: false })
      expect(decision.action).toBe(INLINE_ATTENDANCE_ACTIONS.NORMAL)
    })

    it('uses the normal inline P/A/C behavior for Clear', () => {
      const decision = resolveInlineAttendanceAction({ alreadyInCurrentTable: true, nextValue: null })
      expect(decision.action).toBe(INLINE_ATTENDANCE_ACTIONS.NORMAL)
    })
  })
})

describe('buildHistoricalTransferSnapshot', () => {
  const resultItem = {
    canonical_member_id: 'uuid-123',
    source_table: 'June_2026',
    source_month_label: 'June 2026',
    full_name: 'Abdul Zeinab',
    already_in_current_table: false
  }

  it('builds a snapshot carrying the date-specific Sunday and Present status', () => {
    const snapshot = buildHistoricalTransferSnapshot({
      resultItem,
      currentTable: 'August_2026',
      specificDate: '2026-08-02',
      status: true
    })
    expect(snapshot.canonicalMemberId).toBe('uuid-123')
    expect(snapshot.sourceTable).toBe('June_2026')
    expect(snapshot.sourceMonthLabel).toBe('June 2026')
    expect(snapshot.targetTable).toBe('August_2026')
    expect(snapshot.attendanceDate).toBe('2026-08-02')
    expect(snapshot.attendanceStatus).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(snapshot.memberName).toBe('Abdul Zeinab')
    expect(snapshot.already_in_current_table).toBe(false)
  })

  it('builds a snapshot carrying the Absent status', () => {
    const snapshot = buildHistoricalTransferSnapshot({
      resultItem,
      currentTable: 'August_2026',
      specificDate: '2026-08-02',
      status: 'Absent'
    })
    expect(snapshot.attendanceStatus).toBe(ATTENDANCE_STATUS.ABSENT)
  })

  it('preserves the canonical member id (no duplicate risk)', () => {
    const snapshot = buildHistoricalTransferSnapshot({
      resultItem,
      currentTable: 'August_2026',
      specificDate: '2026-08-09',
      status: true
    })
    expect(snapshot.canonicalMemberId).toBe('uuid-123')
    expect(snapshot.item.canonical_member_id).toBe('uuid-123')
  })

  it('falls back to the source table label when source_month_label is missing', () => {
    const snapshot = buildHistoricalTransferSnapshot({
      resultItem: { ...resultItem, source_month_label: undefined },
      currentTable: 'August_2026',
      specificDate: '2026-08-02',
      status: true
    })
    expect(snapshot.sourceMonthLabel).toBe('June 2026')
  })
})
