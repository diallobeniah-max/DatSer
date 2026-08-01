import { describe, expect, it } from 'vitest'
import { mergeWorkspaceMemberCodeAssignments, toWorkspaceMemberCodeMap } from './workspaceMemberCodeAssignments'

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
})
