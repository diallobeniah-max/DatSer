import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCAL_ONLY_PREFERENCE_KEYS, PERSONAL_PREFERENCE_KEYS, getPersonalSettingsDefaults, pickPersonalPreferencePatch } from '../config/settingsRegistry'
import { setDurableOfflineSetupMeta, getDurableOfflineSetupMeta, clearDurableOfflineSetupMeta, isOfflineSetupDismissedSession, markOfflineSetupDismissedSession } from '../utils/offlineStore'
import { addMemberDeleteTombstone, isMemberStaleDeleted, filterDeletedMembers, clearMemberDeleteTombstones } from '../utils/memberDeleteTombstones'
import { applyPendingChangesToMemberSnapshot, applyPendingAttendanceChanges } from './AppContext'

describe('AppContext & Auth offline safety and hardening regression suite', () => {
  beforeEach(() => {
    clearMemberDeleteTombstones()
  })

  // 1. attendance_control_mode is local-only and defaults to 'pa'
  it('1. attendance_control_mode defaults to pa', () => {
    const defaults = getPersonalSettingsDefaults()
    expect(defaults.attendance_control_mode).toBe('pa')
  })

  // 2. attendance_control_mode is omitted from server preference keys
  it('2. attendance_control_mode is in LOCAL_ONLY_PREFERENCE_KEYS and omitted from PERSONAL_PREFERENCE_KEYS', () => {
    expect(LOCAL_ONLY_PREFERENCE_KEYS.has('attendance_control_mode')).toBe(true)
    expect(PERSONAL_PREFERENCE_KEYS.includes('attendance_control_mode')).toBe(false)

    // pickPersonalPreferencePatch must strip it
    const patch = {
      dashboard_member_columns: 2,
      attendance_control_mode: 'pac'
    }
    const picked = pickPersonalPreferencePatch(patch)
    expect(picked.dashboard_member_columns).toBe(2)
    expect(picked.attendance_control_mode).toBeUndefined()
  })

  // 3. Saving dashboard_member_columns still succeeds when local attendance_control_mode exists
  it('3. saving dashboard_member_columns can cleanly filter out local-only keys', () => {
    const mixedPatch = {
      dashboard_member_columns: 2,
      attendance_control_mode: 'pac'
    }
    const serverPatch = Object.fromEntries(
      Object.entries(mixedPatch).filter(([k]) => !LOCAL_ONLY_PREFERENCE_KEYS.has(k))
    )
    expect(serverPatch).toEqual({ dashboard_member_columns: 2 })
    expect(serverPatch.attendance_control_mode).toBeUndefined()
  })

  it('3b. offline attendance and member delete sync have no direct monthly-table mutations', () => {
    const appContextSource = readFileSync(resolve(process.cwd(), 'src/context/AppContext.jsx'), 'utf8')
    const deleteRetrySource = readFileSync(resolve(process.cwd(), 'src/utils/offlineDeleteRetry.js'), 'utf8')
    const deleteSyncStart = appContextSource.indexOf("} else if (change.action_type === 'member_delete')")
    const deleteSyncEnd = appContextSource.indexOf('await removeOfflineChange(change.local_change_id)', deleteSyncStart)
    const deleteSyncSource = appContextSource.slice(deleteSyncStart, deleteSyncEnd)
    const attendanceSyncStart = appContextSource.indexOf('if (queuedPresent !== null && (queuedPresent === true || queuedPresent === false))')
    const attendanceSyncEnd = appContextSource.indexOf('await removeOfflineChange(change.local_change_id)', attendanceSyncStart)
    const attendanceSyncSource = appContextSource.slice(attendanceSyncStart, attendanceSyncEnd)

    expect(appContextSource).not.toMatch(/\.from\(changeTable\)\s*\.\s*(?:update|delete)\s*\(/)
    expect(deleteSyncSource).not.toMatch(/\.from\([^)]*\)\s*\.\s*(?:update|delete)\s*\(/)
    expect(attendanceSyncSource).not.toMatch(/\.from\([^)]*\)\s*\.\s*(?:update|delete)\s*\(/)
    expect(deleteRetrySource).not.toMatch(/\.from\([^)]*\)\s*\.\s*(?:update|delete)\s*\(/)
    expect(appContextSource).toContain("supabase.rpc('soft_delete_member'")
    expect(appContextSource).toContain("supabase.rpc('set_workspace_month_member_attendance'")
  })

  // 4. offline setup metadata is User A / Workspace A scoped
  it('4. offline setup metadata is strictly User A and Workspace A scoped', () => {
    clearDurableOfflineSetupMeta('user-a', 'workspace-a')
    clearDurableOfflineSetupMeta('user-a', 'workspace-b')
    clearDurableOfflineSetupMeta('user-b', 'workspace-a')

    setDurableOfflineSetupMeta({
      userId: 'user-a',
      ownerId: 'workspace-a',
      memberCount: 50
    })

    // User A on Workspace A is ready
    expect(getDurableOfflineSetupMeta('user-a', 'workspace-a')).not.toBeNull()
    expect(getDurableOfflineSetupMeta('user-a', 'workspace-a').memberCount).toBe(50)

    // Switching workspace does NOT reuse another workspace's ready state
    expect(getDurableOfflineSetupMeta('user-a', 'workspace-b')).toBeNull()

    // Another user on same workspace does NOT appear ready
    expect(getDurableOfflineSetupMeta('user-b', 'workspace-a')).toBeNull()

    clearDurableOfflineSetupMeta('user-a', 'workspace-a')
  })

  // 5. Session dismissal does not mark offline setup complete
  it('5. session dismissal tracks in-session dismissal without marking setup complete', () => {
    expect(isOfflineSetupDismissedSession('user-x', 'workspace-x')).toBe(false)
    markOfflineSetupDismissedSession('user-x', 'workspace-x')

    expect(isOfflineSetupDismissedSession('user-x', 'workspace-x')).toBe(true)
    // Setup itself is NOT marked complete
    expect(getDurableOfflineSetupMeta('user-x', 'workspace-x')).toBeNull()
  })

  // 6. Delete tombstone table scoping and historical member preservation
  it('6. delete tombstone scopes to targeted month, preserving historical month member', () => {
    const deletedAt = '2026-08-15T12:00:00.000Z'
    addMemberDeleteTombstone('member-123', deletedAt, 'August_2026')

    const augustRow = { id: 'member-123', full_name: 'Member 123', updated_at: '2026-08-01T00:00:00.000Z' }
    const julyRow = { id: 'member-123', full_name: 'Member 123', updated_at: '2026-08-01T00:00:00.000Z' }

    // Stale deleted in August_2026
    expect(isMemberStaleDeleted(augustRow, undefined, 'August_2026')).toBe(true)
    expect(filterDeletedMembers([augustRow], undefined, 'August_2026')).toEqual([])

    // Preserved in July_2026
    expect(isMemberStaleDeleted(julyRow, undefined, 'July_2026')).toBe(false)
    expect(filterDeletedMembers([julyRow], undefined, 'July_2026')).toEqual([julyRow])
  })

  // 7. Pending mutations overlay: member edits, deletes, and attendance marks
  it('7. pending mutation overlay accurately applies edits, deletes, and attendance', () => {
    const baseMembers = [
      { id: 'm1', full_name: 'Alice', current_level: 'JHS1' },
      { id: 'm2', full_name: 'Bob', current_level: 'JHS2' }
    ]

    const pending = [
      { action_type: 'member_update', table_name: 'August_2026', member_id: 'm1', updates: { full_name: 'Alice Updated' } },
      { action_type: 'member_delete', table_name: 'August_2026', member_id: 'm2' }
    ]

    const effective = applyPendingChangesToMemberSnapshot(baseMembers, pending, 'August_2026')
    expect(effective.length).toBe(1)
    expect(effective[0].id).toBe('m1')
    expect(effective[0].full_name).toBe('Alice Updated')
  })

  // 8. Attendance Clear only modifies selected Sunday and leaves other Sundays untouched
  it('8. attendance Clear mutation removes only targeted Sunday without modifying others', () => {
    const baseAttendance = {
      '2026-08-02': { m1: true, m2: false },
      '2026-08-09': { m1: true, m2: true }
    }

    const pendingClear = [
      {
        action_type: 'attendance_mark',
        table_name: 'August_2026',
        service_date: '2026-08-02',
        member_id: 'm1',
        present: null // Cleared
      }
    ]

    const effectiveAttendance = applyPendingAttendanceChanges(baseAttendance, pendingClear, 'August_2026')
    // 2026-08-02 m1 is cleared
    expect(effectiveAttendance['2026-08-02'].m1).toBeUndefined()
    expect(effectiveAttendance['2026-08-02'].m2).toBe(false)

    // 2026-08-09 m1 and m2 are UNCHANGED
    expect(effectiveAttendance['2026-08-09'].m1).toBe(true)
    expect(effectiveAttendance['2026-08-09'].m2).toBe(true)
  })
})
