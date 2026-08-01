import { describe, expect, it, vi } from 'vitest'
import { mergeWorkspaceMemberCodeAssignments, readAllWorkspaceMemberCodeAssignmentPages, toWorkspaceMemberCodeMap } from './workspaceMemberCodeAssignments'

describe('workspace member-code assignments', () => {
  it('creates a new immutable map and ignores older assignment responses', () => {
    const cached = toWorkspaceMemberCodeMap([{ member_id: '1', current_code: 'AAA', updated_at: '2026-08-01T10:00:00Z' }])
    const confirmed = toWorkspaceMemberCodeMap([{ member_id: '1', current_code: '001', updated_at: '2026-08-01T10:01:00Z' }])
    const stale = toWorkspaceMemberCodeMap([{ member_id: '1', current_code: 'A01', updated_at: '2026-08-01T09:59:00Z' }])

    const next = mergeWorkspaceMemberCodeAssignments(cached, confirmed)
    const settled = mergeWorkspaceMemberCodeAssignments(next, stale)

    expect(next).not.toBe(cached)
    expect(settled).not.toBe(next)
    expect(settled['1'].current_code).toBe('001')
  })

  it('deduplicates repeated assignment events by canonical member ID', () => {
    const map = toWorkspaceMemberCodeMap([
      { member_id: '1', current_code: 'AAA', updated_at: '2026-08-01T10:00:00Z' },
      { member_id: '1', current_code: 'AAB', updated_at: '2026-08-01T10:01:00Z' }
    ])
    expect(Object.keys(map)).toEqual(['1'])
    expect(map['1'].current_code).toBe('AAB')
  })

  it('keeps the newest row when paginated data arrives out of order', () => {
    const map = toWorkspaceMemberCodeMap([
      { member_id: 'recent-member', current_code: '018', updated_at: '2026-08-01T10:03:00Z' },
      { member_id: 'recent-member', current_code: '017', updated_at: '2026-08-01T10:02:00Z' }
    ])

    expect(map['recent-member'].current_code).toBe('018')
  })

  it('merges a new confirmed assignment without blanking cached badges from another page', () => {
    const cached = toWorkspaceMemberCodeMap([
      { member_id: 'existing-member', current_code: '061', updated_at: '2026-08-01T10:00:00Z' }
    ])
    const added = toWorkspaceMemberCodeMap([
      { member_id: 'new-member', current_code: '062', updated_at: '2026-08-01T10:01:00Z' }
    ])

    const merged = mergeWorkspaceMemberCodeAssignments(cached, added)
    expect(merged['existing-member'].current_code).toBe('061')
    expect(merged['new-member'].current_code).toBe('062')
  })

  it('reads every page of a workspace with more than one thousand assignments', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      member_id: `member-${index + 1}`,
      current_code: String(index + 1).padStart(3, '0'),
      ordinal: index + 1,
      updated_at: '2026-08-01T10:00:00Z'
    }))
    const fetchPage = vi.fn(async (from, pageSize) => rows.slice(from, from + pageSize))

    const assignments = await readAllWorkspaceMemberCodeAssignmentPages({ fetchPage, pageSize: 500 })

    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(assignments).toHaveLength(1001)
    expect(assignments[499].member_id).toBe('member-500')
    expect(assignments[500].member_id).toBe('member-501')
    expect(assignments[999].member_id).toBe('member-1000')
    expect(assignments[1000].member_id).toBe('member-1001')
  })
})
