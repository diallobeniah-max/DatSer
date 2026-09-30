import { describe, expect, it, vi } from 'vitest'
import { matchQuickSundayNames, QUICK_SUNDAY_STATUS, saveQuickSundayAttendance } from './quickSundayList'

describe('Quick Sunday List', () => {
  const members = [{ id: 'a', full_name: 'Freda Owusuaa' }, { id: 'b', full_name: 'Ama Doe' }]
  it('uses only selected-register members and keeps fuzzy names in review', () => {
    const [exact, fuzzy, missing] = matchQuickSundayNames({ names: ['Freda Owusuaa', 'Friday Owusuaa', 'Nobody'], members })
    expect(exact.status).toBe(QUICK_SUNDAY_STATUS.READY)
    expect(fuzzy.status).toBe(QUICK_SUNDAY_STATUS.NEEDS_REVIEW)
    expect(missing.status).toBe(QUICK_SUNDAY_STATUS.NOT_FOUND)
  })
  it('sends only confirmed existing members to the narrow Present-only RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
    const result = await saveQuickSundayAttendance({ supabase: { rpc }, ownerId: 'owner', actorUserId: 'owner', monthStart: '2026-08-01', attendanceDate: '2026-08-16', scanId: 'scan', rows: [
      { status: QUICK_SUNDAY_STATUS.READY, selectedMemberId: 'a' },
      { status: QUICK_SUNDAY_STATUS.NEEDS_REVIEW, selectedMemberId: 'b' }
    ] })
    expect(result).toEqual([{ memberId: 'a', success: true, error: '' }])
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_member_id: 'a', p_attendance_status: 'Present', p_attendance_date: '2026-08-16' })
  })

  it('blocks the legacy Quick Sunday writer while Member V2 work is pending', async () => {
    const rpc = vi.fn()
    const values = new Map([[
      'datser.member-v2.local-flow-guard:owner:owner',
      JSON.stringify({ pendingChanges: 1, failedChanges: 0, conflicts: 0 }),
    ]])
    const storage = { getItem: (key) => values.get(key) || null }

    await expect(saveQuickSundayAttendance({
      supabase: { rpc }, ownerId: 'owner', actorUserId: 'owner', monthStart: '2026-08-01',
      attendanceDate: '2026-08-16', scanId: 'scan', guardEnv: { DEV: true }, guardStorage: storage,
      rows: [{ status: QUICK_SUNDAY_STATUS.READY, selectedMemberId: 'a' }],
    })).rejects.toThrow(/unsynced local work/i)

    expect(rpc).not.toHaveBeenCalled()
  })
})
