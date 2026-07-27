import { describe, expect, it } from 'vitest'
import { classifyMemberSearch, shouldShowSearchDebug } from './memberSearch'

const members = [
  { id: '1', full_name: 'Beniah Opong Diallo', member_code: 'B01', phone_number: '024 430 7261', parent_phone_1: '+233 24 111 7261', parent_phone_2: '024-999-5555' },
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

  it('finds every meaningful name part in either token order', () => {
    for (const query of ['Beniah', 'Opong', 'Diallo', 'Beniah Diallo', 'Diallo Beniah', '  opong  ']) {
      expect(classifyMemberSearch({ members, query }).visible.map((member) => member.id)).toContain('1')
    }
  })

  it('normalizes punctuation and Unicode without treating unrelated fuzzy matches as results', () => {
    const specialMembers = [
      { id: '4', full_name: "Esi O’Fori", member_code: 'E04' },
      { id: '5', full_name: 'Nana-Kofi Osei', member_code: 'N05' }
    ]
    expect(classifyMemberSearch({ members: specialMembers, query: 'esi ofori' }).visible.map((member) => member.id)).toEqual(['4'])
    expect(classifyMemberSearch({ members: specialMembers, query: 'nana kofi' }).visible.map((member) => member.id)).toEqual(['5'])
    expect(classifyMemberSearch({ members: specialMembers, query: 'random unrelated name' }).visible).toEqual([])
  })

  it('matches member and guardian phones across safe Ghana local and country-code formats', () => {
    expect(classifyMemberSearch({ members, query: '0244307261' }).visible.map((member) => member.id)).toContain('1')
    expect(classifyMemberSearch({ members, query: '+233244307261' }).visible.map((member) => member.id)).toContain('1')
    expect(classifyMemberSearch({ members, query: '0241117261' }).visible.map((member) => member.id)).toContain('1')
    expect(classifyMemberSearch({ members, query: '0249995555' }).visible.map((member) => member.id)).toContain('1')
  })
})

describe('shouldShowSearchDebug', () => {
  it('requires both local development and the explicit flag', () => {
    expect(shouldShowSearchDebug({ isDevelopment: true, flag: 'true' })).toBe(true)
    expect(shouldShowSearchDebug({ isDevelopment: false, flag: 'true' })).toBe(false)
    expect(shouldShowSearchDebug({ isDevelopment: true, flag: 'false' })).toBe(false)
  })
})
