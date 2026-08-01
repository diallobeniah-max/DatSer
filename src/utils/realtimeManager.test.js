import { describe, expect, it, vi } from 'vitest'
import { createResumeSyncCoordinator } from './appResumeSync'
import { classifyMemberSearch } from './memberSearch'
import { mergeAttendanceMapWithPending, mergeRealtimeMemberWithPending } from './realtimeMerge'

describe('Local-First Search (Zero Network Calls)', () => {
  it('searches active canonical members in memory without network requests', () => {
    const activeMembers = [
      { id: 'mem-1', 'Full Name': 'Beniah Opong', 'Phone Number': '0551234567' },
      { id: 'mem-2', 'Full Name': 'Ama Serwaa', 'Phone Number': '0249876543' },
      { id: 'mem-3', 'Full Name': 'Beniah Opong Dizzz', 'Phone Number': '0501112223' }
    ]

    const result = classifyMemberSearch({
      members: activeMembers,
      query: 'Beniah',
      getCode: (m) => (m.id === 'mem-1' ? '1282' : m.id === 'mem-3' ? '1283' : ''),
      codeLength: 3
    })

    expect(result.visible).toHaveLength(2)
    expect(result.visible.map((m) => m.id)).toEqual(['mem-1', 'mem-3'])
  })

  it('keeps members with duplicate or similar names separate', () => {
    const activeMembers = [
      { id: 'mem-10', 'Full Name': 'John Doe', 'Phone Number': '111' },
      { id: 'mem-11', 'Full Name': 'John Doe', 'Phone Number': '222' }
    ]

    const result = classifyMemberSearch({
      members: activeMembers,
      query: 'John',
      getCode: () => '',
      codeLength: 3
    })

    expect(result.visible).toHaveLength(2)
    expect(result.visible.map((m) => m.id)).toEqual(['mem-10', 'mem-11'])
  })
})

describe('Single-Flight Sync Coordinator', () => {
  it('coalesces simultaneous mount, focus, pageshow, and reconnect triggers into 1 sync pass', async () => {
    let syncCount = 0
    const refresh = vi.fn(async () => {
      syncCount++
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { success: true }
    })

    const coordinator = createResumeSyncCoordinator({ refresh, cooldownMs: 1800 })

    const p1 = coordinator.trigger('mount')
    const p2 = coordinator.trigger('focus')
    const p3 = coordinator.trigger('pageshow')
    const p4 = coordinator.trigger('reconnect')

    await Promise.all([p1, p2, p3, p4])

    expect(syncCount).toBe(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('enforces cooldown for non-forced triggers', async () => {
    let syncCount = 0
    let nowTime = 1000
    const refresh = vi.fn(async () => {
      syncCount++
      return { success: true }
    })

    const coordinator = createResumeSyncCoordinator({
      refresh,
      now: () => nowTime,
      cooldownMs: 1800
    })

    await coordinator.trigger('mount')
    expect(syncCount).toBe(1)

    nowTime = 1500 // 500ms later (within 1800ms cooldown)
    const res2 = await coordinator.trigger('focus')
    expect(res2).toEqual({ skipped: 'cooldown' })
    expect(syncCount).toBe(1)

    nowTime = 3000 // 2000ms later (after cooldown)
    await coordinator.trigger('visibility')
    expect(syncCount).toBe(2)
  })
})

describe('Targeted Realtime Merges', () => {
  it('merges a single realtime member update without clearing existing fields', () => {
    const existing = { id: 'm-1', 'Full Name': 'Old Name', 'Phone Number': '0555555555', age: '25' }
    const payload = { id: 'm-1', 'Full Name': 'New Name' }

    const merged = { ...existing, ...payload }
    const result = mergeRealtimeMemberWithPending(merged, [], 'August_2026')

    expect(result.member.id).toBe('m-1')
    expect(result.member['Full Name']).toBe('New Name')
    expect(result.member['Phone Number']).toBe('0555555555')
    expect(result.member.age).toBe('25')
  })

  it('patches attendance for a single member without re-fetching all columns', () => {
    const previousAttendance = { 'm-1': true, 'm-2': false }
    const merged = mergeAttendanceMapWithPending(
      { ...previousAttendance, 'm-3': true },
      [],
      { tableName: 'August_2026', serviceDate: '2026-08-02' }
    )

    expect(merged).toEqual({ 'm-1': true, 'm-2': false, 'm-3': true })
  })
})
