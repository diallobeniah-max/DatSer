import { describe, expect, it } from 'vitest'
import {
  applyPendingChangesToMemberSnapshot,
  applyPendingAttendanceChanges
} from './AppContext'

describe('AppContext offline pending mutations replay', () => {
  const baseMembers = [
    { id: 'member-1', full_name: 'Original Name 1', current_level: 'JHS1' },
    { id: 'member-2', full_name: 'Original Name 2', current_level: 'JHS2' },
    { id: 'member-3', full_name: 'Original Name 3', current_level: 'JHS3' }
  ]

  it('removes member when pending action is member_delete', () => {
    const pendingChanges = [
      {
        action_type: 'member_delete',
        table_name: 'August_2026',
        member_id: 'member-2'
      }
    ]

    const result = applyPendingChangesToMemberSnapshot(baseMembers, pendingChanges, 'August_2026')
    expect(result.map(m => m.id)).toEqual(['member-1', 'member-3'])
  })

  it('updates member fields when pending action is member_update', () => {
    const pendingChanges = [
      {
        action_type: 'member_update',
        table_name: 'August_2026',
        member_id: 'member-1',
        updates: { full_name: 'Updated Name 1', current_level: 'JHS3' }
      }
    ]

    const result = applyPendingChangesToMemberSnapshot(baseMembers, pendingChanges, 'August_2026')
    const updated = result.find(m => m.id === 'member-1')
    expect(updated.full_name).toBe('Updated Name 1')
    expect(updated.current_level).toBe('JHS3')
  })

  it('overlays attendance marks onto base attendance', () => {
    const baseAttendance = {
      '2026-08-02': { 'member-1': true, 'member-2': false }
    }
    const pendingChanges = [
      {
        action_type: 'attendance_mark',
        table_name: 'August_2026',
        service_date: '2026-08-02',
        member_id: 'member-2',
        present: true
      },
      {
        action_type: 'attendance_mark',
        table_name: 'August_2026',
        service_date: '2026-08-09',
        member_id: 'member-1',
        present: false
      }
    ]

    const result = applyPendingAttendanceChanges(baseAttendance, pendingChanges, 'August_2026')
    expect(result['2026-08-02']['member-2']).toBe(true)
    expect(result['2026-08-09']['member-1']).toBe(false)
  })

  it('removes attendance when marked cleared (null present)', () => {
    const baseAttendance = {
      '2026-08-02': { 'member-1': true, 'member-2': false }
    }
    const pendingChanges = [
      {
        action_type: 'attendance_mark',
        table_name: 'August_2026',
        service_date: '2026-08-02',
        member_id: 'member-1',
        present: null
      }
    ]

    const result = applyPendingAttendanceChanges(baseAttendance, pendingChanges, 'August_2026')
    expect(result['2026-08-02']['member-1']).toBeUndefined()
    expect(result['2026-08-02']['member-2']).toBe(false)
  })
})
