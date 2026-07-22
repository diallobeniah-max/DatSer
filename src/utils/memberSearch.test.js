import { describe, expect, it } from 'vitest'
import { classifyMemberSearch, shouldShowSearchDebug } from './memberSearch'

const members = [
  { id: '1', full_name: 'Beniah Diallo', member_code: 'B01' },
  { id: '2', full_name: 'Benedicta Mensah', member_code: 'B02' },
  { id: '3', full_name: 'Ama Serwaa', member_code: 'A03' }
]

describe('classifyMemberSearch', () => {
  it('keeps exact and partial matches distinct and count aligned to visible rows', () => {
    const exact = classifyMemberSearch({ members, query: 'B01' })
    expect(exact.status).toBe('exact')
    expect(exact.visible.map((member) => member.id)).toEqual(['1'])
    expect(exact.visibleCount).toBe(exact.visible.length)

    const partial = classifyMemberSearch({ members, query: 'Beni' })
    expect(partial.status).toBe('partial')
    expect(partial.visible.map((member) => member.id)).toEqual(['1'])
  })

  it('separates fuzzy suggestions instead of rendering them as normal results', () => {
    const result = classifyMemberSearch({ members, query: 'Benaiah' })
    expect(result.visible).toEqual([])
    expect(result.suggestions.map((member) => member.id)).toEqual(['1'])
    expect(result.status).toBe('suggested')
  })

  it('never reintroduces soft-deleted or stale cached members', () => {
    const deleted = { id: '4', full_name: 'Deleted Person', deleted_at: '2026-07-22T00:00:00Z' }
    const result = classifyMemberSearch({ members: [...members, deleted], remoteMembers: [deleted], query: 'Deleted Person' })
    expect(result.visible).toEqual([])
  })

  it('identifies a known deleted member without showing it as active', () => {
    const deleted = { id: '4', full_name: 'Deleted Person', deleted_at: '2026-07-22T00:00:00Z' }
    const result = classifyMemberSearch({ members, deletedMembers: [deleted], query: 'Deleted Person' })
    expect(result.status).toBe('deleted')
    expect(result.visible).toEqual([])
    expect(result.deletedMatches).toHaveLength(1)
  })

  it('uses the newest renamed member identity and stops matching the old name', () => {
    const renamed = { id: '1', full_name: 'Yaw Diallo', member_code: 'B01' }
    expect(classifyMemberSearch({ members: [renamed], query: 'Beniah' }).visible).toEqual([])
    expect(classifyMemberSearch({ members: [renamed], query: 'Yaw' }).visible.map((member) => member.id)).toEqual(['1'])
  })
})

describe('shouldShowSearchDebug', () => {
  it('requires both local development and the explicit flag', () => {
    expect(shouldShowSearchDebug({ isDevelopment: true, flag: 'true' })).toBe(true)
    expect(shouldShowSearchDebug({ isDevelopment: false, flag: 'true' })).toBe(false)
    expect(shouldShowSearchDebug({ isDevelopment: true, flag: 'false' })).toBe(false)
  })
})
