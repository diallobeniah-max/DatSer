import { describe, expect, it } from 'vitest'
import { buildMemberV2AttendanceOverlay, mergeMemberV2AttendanceOverlay } from './memberV2AttendanceOverlay'

const attendance = (overrides = {}) => ({
  table_name: 'January_2026',
  member_id: 'member-1',
  attendance_date: '2026-01-04',
  status: 'Present',
  is_deleted: false,
  ...overrides,
})

describe('Member V2 attendance overlay', () => {
  it('keeps a durable pending local Present visible over a stale legacy refresh', () => {
    const overlay = buildMemberV2AttendanceOverlay([attendance()])
    const merged = mergeMemberV2AttendanceOverlay({
      attendanceData: { '2026-01-04': {} },
      tableName: 'January_2026',
      overlay,
    })
    expect(merged['2026-01-04']['member-1']).toBe(true)
  })

  it('keeps the selected member and Sunday isolated from a different month or date', () => {
    const overlay = buildMemberV2AttendanceOverlay([
      attendance(),
      attendance({ member_id: 'member-2', attendance_date: '2026-01-11', status: 'Absent' }),
      attendance({ table_name: 'February_2026', attendance_date: '2026-02-01' }),
    ])
    const merged = mergeMemberV2AttendanceOverlay({ attendanceData: {}, tableName: 'January_2026', overlay })
    expect(merged).toEqual({
      '2026-01-04': { 'member-1': true },
      '2026-01-11': { 'member-2': false },
    })
  })

  it('keeps a durable Clear visible over a stale legacy Present value', () => {
    const overlay = buildMemberV2AttendanceOverlay([attendance({ status: null, is_deleted: true })])
    const merged = mergeMemberV2AttendanceOverlay({
      attendanceData: { '2026-01-04': { 'member-1': true, 'member-2': false } },
      tableName: 'January_2026',
      overlay,
    })
    expect(merged['2026-01-04']).toEqual({ 'member-2': false })
  })
})
