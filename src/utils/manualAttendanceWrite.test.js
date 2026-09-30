import { describe, expect, it, vi } from 'vitest'
import { writeManualAttendance } from './manualAttendanceWrite'
import { updateMemberV2LocalFlowGuard } from '../experiments/rxdb-member-phase1/memberV2FeatureFlag'

const legacyRouteEnv = { DEV: true, VITE_DATSER_MEMBER_V2_EXPERIMENT: 'false', VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }

const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const setup = async (present, response = { success: true, member_id: 'member-1' }) => {
  const rpc = vi.fn(() => Promise.resolve({ data: response, error: null }))
  const executeWrite = vi.fn((operation) => operation())
  const result = await writeManualAttendance({
    supabase: { rpc },
    executeWrite,
    tableName: 'January_2026',
    ownerId: 'owner-1',
    actorUserId: 'actor-1',
    memberId: 'member-1',
    attendanceDate: new Date(2026, 0, 25),
    present,
    identity: { source: 'manual-test' },
    guardEnv: legacyRouteEnv,
  })
  return { rpc, executeWrite, result }
}

describe('writeManualAttendance', () => {
  it('uses the attendance-only RPC for Present without a profile payload', async () => {
    const { rpc, result } = await setup(true)

    expect(result).toMatchObject({ memberId: 'member-1', attendanceDate: '2026-01-25', status: 'Present' })
    expect(rpc).toHaveBeenCalledWith('set_workspace_month_member_attendance', expect.objectContaining({
      p_owner_id: 'owner-1',
      p_month_start: '2026-01-01',
      p_member_id: 'member-1',
      p_attendance_date: '2026-01-25',
      p_attendance_status: 'Present'
    }))
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_updates')
  })

  it('uses the same attendance-only RPC for Absent', async () => {
    const { rpc, result } = await setup(false)

    expect(result.status).toBe('Absent')
    expect(rpc).toHaveBeenCalledWith('set_workspace_month_member_attendance', expect.objectContaining({
      p_attendance_status: 'Absent'
    }))
  })

  it('uses the approved attendance payload only when clearing', async () => {
    const { rpc, result } = await setup(null)

    expect(result.status).toBe('Cleared')
    expect(rpc).toHaveBeenCalledWith('update_member_bundle_resilient', expect.objectContaining({
      p_updates: {},
      p_badges: null,
      p_tag_ids: null,
      p_attendance: { '2026-01-25': null }
    }))
  })

  it('rejects a response that does not confirm the requested member', async () => {
    await expect(setup(true, { success: true, member_id: 'another-member' })).rejects.toThrow('Attendance save could not be verified')
  })

  it.each([['Present', true], ['Absent', false], ['Clear', null]])(
    'blocks the %s legacy RPC while a durable Member V2 mutation is pending',
    async (_label, present) => {
      const localStorage = memoryStorage()
      updateMemberV2LocalFlowGuard({
        userId: 'actor-1',
        ownerId: 'owner-1',
        storage: localStorage,
        syncState: { state: 'OFFLINE_PENDING', pendingChanges: 1, failedChanges: 0, conflicts: 0 },
      })
      const rpc = vi.fn()
      const executeWrite = vi.fn((operation) => operation())

      await expect(writeManualAttendance({
        supabase: { rpc }, executeWrite, tableName: 'January_2026', ownerId: 'owner-1', actorUserId: 'actor-1',
        memberId: 'member-1', attendanceDate: new Date(2026, 0, 25), present,
        guardEnv: legacyRouteEnv, guardStorage: localStorage,
      })).rejects.toThrow(/unsynced local work/i)

      expect(executeWrite).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
      expect(localStorage.getItem('datser.member-v2.local-flow-guard:actor-1:owner-1')).toContain('"pendingChanges":1')
    }
  )
})
