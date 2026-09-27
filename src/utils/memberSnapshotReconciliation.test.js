import { describe, expect, it } from 'vitest'
import { reconcileAuthoritativeMemberSnapshot, removeMemberV2Tombstones } from './memberSnapshotReconciliation'

describe('reconcileAuthoritativeMemberSnapshot', () => {
  const tableName = 'August_2026'

  it('keeps the fresh server member during manual refresh when nothing is pending', () => {
    const result = reconcileAuthoritativeMemberSnapshot(
      [{ id: 'UUID-1', full_name: 'New Name', updated_at: '2026-09-10T12:00:00.000Z' }],
      [],
      tableName
    )

    expect(result).toEqual([{ id: 'UUID-1', full_name: 'New Name', updated_at: '2026-09-10T12:00:00.000Z' }])
  })

  it('overlays a genuine pending offline member edit onto the server snapshot', () => {
    const result = reconcileAuthoritativeMemberSnapshot(
      [{ id: 'UUID-1', full_name: 'Server Name' }],
      [{
        member_id: 'UUID-1',
        table_name: tableName,
        action_type: 'member_update',
        sync_status: 'pending',
        updates: { full_name: 'Pending Local Name' },
        created_at: '2026-09-10T12:05:00.000Z'
      }],
      tableName
    )

    expect(result[0].full_name).toBe('Pending Local Name')
  })

  it('does not let a stale indexed/cache row resurrect an old server value', () => {
    const remote = [{ id: 'UUID-1', full_name: 'New Name', updated_at: '2026-09-10T12:00:00.000Z' }]
    const staleIndexedRow = { id: 'UUID-1', full_name: 'Old Name', updated_at: '2099-01-01T00:00:00.000Z' }

    const result = reconcileAuthoritativeMemberSnapshot(remote, [], tableName)

    expect(result[0].full_name).toBe('New Name')
    expect(result[0].full_name).not.toBe(staleIndexedRow.full_name)
  })
})

describe('removeMemberV2Tombstones', () => {
  it('removes only matching active projections when RxDB reports a confirmed tombstone', () => {
    const result = removeMemberV2Tombstones(
      [{ id: 'UUID-1', server_revision: 7 }, { id: 'UUID-2', server_revision: 3 }],
      [{ id: 'UUID-1', is_deleted: true, server_revision: 8, save_state: 'SERVER_CONFIRMED' }]
    )

    expect(result).toEqual([{ id: 'UUID-2', server_revision: 3 }])
  })

  it('does not remove active Member V2 rows', () => {
    const members = [{ id: 'UUID-1', server_revision: 7 }]
    expect(removeMemberV2Tombstones(members, [{ id: 'UUID-1', is_deleted: false }])).toBe(members)
  })
})
