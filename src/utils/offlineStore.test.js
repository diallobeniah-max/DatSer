import { describe, expect, it } from 'vitest'
import { coalesceOfflineChange } from './offlineStore'

describe('offline mutation coalescing', () => {
  it('keeps only the newest attendance intent for a member and Sunday', () => {
    const original = {
      local_change_id: 'attendance_July_2026_2026-07-19_member-1',
      action_type: 'attendance_mark',
      table_name: 'July_2026',
      member_id: 'member-1',
      present: true,
      created_at: '2026-07-19T09:00:00.000Z'
    }
    const next = coalesceOfflineChange([original], { ...original, present: false }, '2026-07-19T09:01:00.000Z')
    expect(next.queuedChange.present).toBe(false)
    expect(next.queuedChange.created_at).toBe(original.created_at)
    expect(next.queuedChange.client_revision).toBe(1)
  })

  it('folds an offline edit into an unsynced add', () => {
    const add = {
      local_change_id: 'member_add_member-1',
      action_type: 'member_add',
      table_name: 'July_2026',
      member_id: 'member-1',
      member_data: { id: 'member-1', full_name: 'Synthetic Member' },
      client_revision: 1
    }
    const next = coalesceOfflineChange([add], {
      local_change_id: 'member_update_July_2026_member-1',
      action_type: 'member_update',
      table_name: 'July_2026',
      member_id: 'member-1',
      updates: { current_level: 'JHS2' }
    })
    expect(next.queuedChange.action_type).toBe('member_add')
    expect(next.queuedChange.member_data.current_level).toBe('JHS2')
  })

  it('cancels an unsynced add when the local member is deleted', () => {
    const add = {
      local_change_id: 'member_add_member-1',
      action_type: 'member_add',
      table_name: 'July_2026',
      member_id: 'member-1'
    }
    const next = coalesceOfflineChange([add], {
      local_change_id: 'member_delete_July_2026_member-1',
      action_type: 'member_delete',
      table_name: 'July_2026',
      member_id: 'member-1'
    })
    expect(next.queuedChange).toBeNull()
    expect(next.removeIds).toEqual(['member_add_member-1'])
  })

  it('merges repeated member edits without dropping earlier fields', () => {
    const first = coalesceOfflineChange([], {
      local_change_id: 'member_update_July_2026_member-1',
      action_type: 'member_update',
      table_name: 'July_2026',
      member_id: 'member-1',
      updates: { full_name: 'Synthetic Member' }
    }, '2026-07-21T10:00:00.000Z').queuedChange

    const second = coalesceOfflineChange([first], {
      local_change_id: 'member_update_July_2026_member-1',
      action_type: 'member_update',
      table_name: 'July_2026',
      member_id: 'member-1',
      updates: { parent_name_1: 'Synthetic Guardian' }
    }, '2026-07-21T10:01:00.000Z').queuedChange

    expect(second.updates).toEqual({
      full_name: 'Synthetic Member',
      parent_name_1: 'Synthetic Guardian'
    })
    expect(second.client_revision).toBe(2)
  })
})
