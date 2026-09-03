import { describe, expect, it } from 'vitest'
import { coalesceOfflineChange, filterPreviewMembersForWrite, isCompleteOfflineSnapshot, setDurableOfflineSetupMeta, getDurableOfflineSetupMeta, clearDurableOfflineSetupMeta, markOfflineSetupDismissedSession, isOfflineSetupDismissedSession } from './offlineStore'

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

describe('member preview persistence filtering', () => {
  it('D: preview cache persistence excludes deleted rows', () => {
    const active = { id: 'a', full_name: 'Active' }
    const deleted = { id: 'd', full_name: 'Deleted', deleted_at: '2026-08-07T12:00:00.000Z' }
    expect(filterPreviewMembersForWrite([active, deleted]).map((m) => m.id)).toEqual(['a'])
    expect(filterPreviewMembersForWrite([deleted])).toEqual([])
    expect(filterPreviewMembersForWrite([])).toEqual([])
  })
})

describe('offline workspace isolation', () => {
  const readySnapshot = {
    authenticated_user_id: 'user-a',
    data_owner_id: 'workspace-a',
    completeness: 'complete',
    snapshot: { completeness: 'complete' }
  }

  it('accepts only a complete snapshot for its authenticated workspace', () => {
    expect(isCompleteOfflineSnapshot(readySnapshot, { userId: 'user-a', ownerId: 'workspace-a' })).toBe(true)
  })

  it('never treats another user or workspace snapshot as offline-ready', () => {
    expect(isCompleteOfflineSnapshot(readySnapshot, { userId: 'user-b', ownerId: 'workspace-a' })).toBe(false)
    expect(isCompleteOfflineSnapshot(readySnapshot, { userId: 'user-a', ownerId: 'workspace-b' })).toBe(false)
  })

  it('rejects partial downloads after an interrupted refresh', () => {
    expect(isCompleteOfflineSnapshot({ ...readySnapshot, completeness: 'partial' }, { userId: 'user-a', ownerId: 'workspace-a' })).toBe(false)
  })
})

describe('durable offline setup metadata', () => {
  it('persists and retrieves durable offline setup metadata', () => {
    clearDurableOfflineSetupMeta('user-1', 'owner-1')
    expect(getDurableOfflineSetupMeta('user-1', 'owner-1')).toBeNull()

    setDurableOfflineSetupMeta({
      userId: 'user-1',
      ownerId: 'owner-1',
      memberCount: 42,
      downloadedMonths: ['August_2026']
    })

    const retrieved = getDurableOfflineSetupMeta('user-1', 'owner-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved.offlineReady).toBe(true)
    expect(retrieved.snapshotComplete).toBe(true)
    expect(retrieved.memberCount).toBe(42)

    clearDurableOfflineSetupMeta('user-1', 'owner-1')
    expect(getDurableOfflineSetupMeta('user-1', 'owner-1')).toBeNull()
  })

  it('tracks session-only setup dismissal', () => {
    expect(isOfflineSetupDismissedSession()).toBe(false)
    markOfflineSetupDismissedSession()
    expect(isOfflineSetupDismissedSession()).toBe(true)
  })

  it('strictly scopes durable offline setup metadata to user AND workspace', () => {
    setDurableOfflineSetupMeta({
      userId: 'user-a',
      ownerId: 'workspace-a',
      memberCount: 20
    })

    // Matches User A and Workspace A
    expect(getDurableOfflineSetupMeta('user-a', 'workspace-a')).not.toBeNull()

    // Does NOT match User B on Workspace A
    expect(getDurableOfflineSetupMeta('user-b', 'workspace-a')).toBeNull()

    // Does NOT match User A on Workspace B
    expect(getDurableOfflineSetupMeta('user-a', 'workspace-b')).toBeNull()

    clearDurableOfflineSetupMeta('user-a', 'workspace-a')
  })

  it('scopes session dismissal per workspace and user', () => {
    expect(isOfflineSetupDismissedSession('user-a', 'workspace-a')).toBe(false)
    markOfflineSetupDismissedSession('user-a', 'workspace-a')

    expect(isOfflineSetupDismissedSession('user-a', 'workspace-a')).toBe(true)
    // Other workspace is NOT dismissed
    expect(isOfflineSetupDismissedSession('user-a', 'workspace-b')).toBe(false)
    expect(isOfflineSetupDismissedSession('user-b', 'workspace-a')).toBe(false)
  })
})
