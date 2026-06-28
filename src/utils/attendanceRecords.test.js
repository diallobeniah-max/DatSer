import { describe, expect, it } from 'vitest'
import {
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
})
