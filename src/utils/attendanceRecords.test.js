import { describe, expect, it } from 'vitest'
import {
  isAttendanceAlreadySynced,
  isOfflineAttendanceConflict,
  normalizeAttendanceValue,
  resolveMemberAttendanceForDate,
  getCanonicalAttendanceStatus,
  isMemberMarkedForDate
} from './attendanceRecords'

describe('attendance record resolution', () => {
  it('only treats Present and Absent values as marked attendance', () => {
    expect(normalizeAttendanceValue('Present')).toBe(true)
    expect(normalizeAttendanceValue('Absent')).toBe(false)
    expect(normalizeAttendanceValue(null)).toBeUndefined()
    expect(normalizeAttendanceValue('')).toBeUndefined()
    expect(normalizeAttendanceValue('Clear')).toBeUndefined()
  })

  it('returns Present or Absent for valid status and null for unmarked', () => {
    const member = { id: 'm-1', attendance_2026_08_02: 'Present' }
    const attendanceData = { '2026-08-02': { 'm-2': false } }

    expect(getCanonicalAttendanceStatus({ member, memberId: 'm-1', attendanceDate: '2026-08-02', attendanceData })).toBe('Present')
    expect(getCanonicalAttendanceStatus({ memberId: 'm-2', attendanceDate: '2026-08-02', attendanceData })).toBe('Absent')
    expect(getCanonicalAttendanceStatus({ memberId: 'm-3', attendanceDate: '2026-08-02', attendanceData })).toBeNull()
  })

  it('normalizes boolean and string values consistently', () => {
    expect(getCanonicalAttendanceStatus({ memberId: 'm-1', attendanceDate: '2026-08-02', attendanceData: { '2026-08-02': { 'm-1': true } } })).toBe('Present')
    expect(getCanonicalAttendanceStatus({ memberId: 'm-1', attendanceDate: '2026-08-02', attendanceData: { '2026-08-02': { 'm-1': 'Present' } } })).toBe('Present')
    expect(getCanonicalAttendanceStatus({ memberId: 'm-1', attendanceDate: '2026-08-02', attendanceDate: '2026-08-02', attendanceData: { '2026-08-02': { 'm-1': false } } })).toBe('Absent')
    expect(getCanonicalAttendanceStatus({ memberId: 'm-1', attendanceDate: '2026-08-02', attendanceData: { '2026-08-02': { 'm-1': 'Absent' } } })).toBe('Absent')
  })

  it('correctly identifies marked vs unmarked members', () => {
    const memberPresent = { id: 'm-1', attendance_2026_08_02: 'Present' }
    const memberAbsent = { id: 'm-2', attendance_2026_08_02: 'Absent' }
    const memberUnmarked = { id: 'm-3' }

    expect(isMemberMarkedForDate(memberPresent, '2026-08-02', {})).toBe(true)
    expect(isMemberMarkedForDate(memberAbsent, '2026-08-02', {})).toBe(true)
    expect(isMemberMarkedForDate(memberUnmarked, '2026-08-02', {})).toBe(false)
  })

  it('falls back to member-row attendance columns when no date-keyed value exists', () => {
    const member = {
      id: 'member-1',
      attendance_2026_06_25: 'Present'
    }

    expect(resolveMemberAttendanceForDate(member, '2026-06-25', {})).toBe(true)
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
