import { describe, expect, it } from 'vitest'
import { createAttendanceSnapshotVersionRegistry } from './attendanceSnapshot'

describe('attendance snapshot version registry', () => {
  it('rejects a stale refresh after an optimistic attendance change', () => {
    const registry = createAttendanceSnapshotVersionRegistry()
    const startedAt = registry.startRead('July_2099', '2099-07-19')
    registry.markLocalChange('July_2099', '2099-07-19')

    expect(registry.canApplyRead('July_2099', '2099-07-19', startedAt)).toBe(false)
  })

  it('allows an idempotent refreshed snapshot when no newer local choice exists', () => {
    const registry = createAttendanceSnapshotVersionRegistry()
    registry.markLocalChange('July_2099', '2099-07-19')
    const startedAt = registry.startRead('July_2099', '2099-07-19')

    expect(registry.canApplyRead('July_2099', '2099-07-19', startedAt)).toBe(true)
  })

  it('rejects an older overlapping read after a newer read begins', () => {
    const registry = createAttendanceSnapshotVersionRegistry()
    const firstRead = registry.startRead('July_2099', '2099-07-19')
    const newerRead = registry.startRead('July_2099', '2099-07-19')

    expect(registry.canApplyRead('July_2099', '2099-07-19', firstRead)).toBe(false)
    expect(registry.canApplyRead('July_2099', '2099-07-19', newerRead)).toBe(true)
  })
})
