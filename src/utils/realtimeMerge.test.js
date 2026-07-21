import { describe, expect, it } from 'vitest'
import { mergeAttendanceMapWithPending, mergeRealtimeMemberWithPending } from './realtimeMerge'

describe('mergeRealtimeMemberWithPending', () => {
  it('keeps a pending local edit over an older realtime payload', () => {
    const result = mergeRealtimeMemberWithPending(
      { id: 'member-1', full_name: 'Remote name', age: '12' },
      [{ member_id: 'member-1', table_name: 'July_2026', action_type: 'member_update', updates: { full_name: 'Local name' }, sync_status: 'pending' }],
      'July_2026'
    )

    expect(result.member.full_name).toBe('Local name')
    expect(result.member.age).toBe('12')
    expect(result.member.__offline_status).toBe('pending_sync')
  })

  it('keeps the newest queued attendance intent visible', () => {
    const result = mergeRealtimeMemberWithPending(
      { id: 'member-1', attendance_2026_07_19: 'Present' },
      [{ member_id: 'member-1', table_name: 'July_2026', action_type: 'attendance_mark', service_date: '2026-07-19', present: false, sync_status: 'pending' }],
      'July_2026'
    )

    expect(result.member.attendance_2026_07_19).toBe('Absent')
  })

  it('keeps a locally pending deletion removed', () => {
    const result = mergeRealtimeMemberWithPending(
      { id: 'member-1', full_name: 'Remote name' },
      [{ member_id: 'member-1', table_name: 'July_2026', action_type: 'member_delete', sync_status: 'pending' }],
      'July_2026'
    )

    expect(result.shouldRemove).toBe(true)
  })
})

describe('mergeAttendanceMapWithPending', () => {
  it('prevents a delayed remote event from replacing a queued local choice', () => {
    const merged = mergeAttendanceMapWithPending(
      { 'member-1': true, 'member-2': false },
      [{ member_id: 'member-1', table_name: 'July_2026', service_date: '2026-07-19', action_type: 'attendance_mark', present: false, sync_status: 'pending' }],
      { tableName: 'July_2026', serviceDate: '2026-07-19' }
    )

    expect(merged).toEqual({ 'member-1': false, 'member-2': false })
  })

  it('keeps a queued clear absent from the marked map', () => {
    const merged = mergeAttendanceMapWithPending(
      { 'member-1': true },
      [{ member_id: 'member-1', table_name: 'July_2026', service_date: '2026-07-19', action_type: 'attendance_mark', present: null, sync_status: 'pending' }],
      { tableName: 'July_2026', serviceDate: '2026-07-19' }
    )

    expect(merged).toEqual({})
  })
})
