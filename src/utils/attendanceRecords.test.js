import { describe, expect, it } from 'vitest'
import {
  isAttendanceAlreadySynced,
  isOfflineAttendanceConflict,
  normalizeAttendanceValue,
  resolveMemberAttendanceForDate
} from './attendanceRecords'

describe('attendance record resolution', () => {
  it('only treats Present and Absent values as marked attendance', () => {
    expect(normalizeAttendanceValue('Present')).toBe(true)
    expect(normalizeAttendanceValue('Absent')).toBe(false)
    expect(normalizeAttendanceValue(null)).toBeUndefined()
    expect(normalizeAttendanceValue('')).toBeUndefined()
    expect(normalizeAttendanceValue('Clear')).toBeUndefined()
})

  it('lets a date-keyed cleared value shadow stale member-row attendance columns', () => {
    const member = {
      id: 'member-1',
      attendance_2026_06_25: 'Present',
      'Attendance 25th': 'Absent'
    }

    expect(resolveMemberAttendanceForDate(member, '2026-06-25', { 'member-1': null })).toBeUndefined()
    expect(resolveMemberAttendanceForDate(member, '2026-06-25', { 'member-1': undefined })).toBeUndefined()
  })

  it('falls back to member-row attendance columns only when no date-keyed value exists', () => {
    const member = {
      id: 'member-1',
      attendance_2026_06_25: 'Present'
    }

    expect(resolveMemberAttendanceForDate(member, '2026-06-25', {})).toBe(true)
  })

  it('does not resurrect stale row columns after the server date map is loaded', () => {
    const member = {
      id: 'member-1',
      attendance_2026_06_25: 'Present'
    }

    expect(resolveMemberAttendanceForDate(
      member,
      '2026-06-25',
      {},
      { authoritativeMap: true }
    )).toBeUndefined()
  })

  it('does not treat queued clear/deselect actions as offline conflicts', () => {
    expect(isOfflineAttendanceConflict(true, null)).toBe(false)
    expect(isOfflineAttendanceConflict(false, null)).toBe(false)
    expect(isAttendanceAlreadySynced(undefined, null)).toBe(true)
    expect(isAttendanceAlreadySynced(true, null)).toBe(false)
  })

  it('detects real offline conflicts only for competing present/absent values', () => {
    expect(isOfflineAttendanceConflict(true, false)).toBe(true)
    expect(isOfflineAttendanceConflict(false, true)).toBe(true)
    expect(isOfflineAttendanceConflict(true, true)).toBe(false)
    expect(isOfflineAttendanceConflict(undefined, true)).toBe(false)
  })

  it('uses the original server snapshot so intentional offline changes can sync', () => {
    expect(isOfflineAttendanceConflict(true, false, true, true)).toBe(false)
    expect(isOfflineAttendanceConflict(false, null, false, true)).toBe(false)
    expect(isOfflineAttendanceConflict(true, false, false, true)).toBe(true)
    expect(isOfflineAttendanceConflict(undefined, true, null, true)).toBe(false)
  })
})
