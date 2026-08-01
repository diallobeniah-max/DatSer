import { describe, expect, it } from 'vitest'
import {
  MEMBER_CODE_FORMATS,
  buildMemberIndexCodeMap,
  getLettersOnlyMemberCode,
  getMemberIndexCode,
  getMemberIndexCodeAliases,
  getNumbersOnlyMemberCode,
  getToggledMemberCodeFormat
} from './memberIndexCodes'

describe('workspace member-code formats', () => {
  it('generates the deterministic alphabetical sequence through AA and AB', () => {
    expect(getLettersOnlyMemberCode(1)).toBe('A')
    expect(getLettersOnlyMemberCode(26)).toBe('Z')
    expect(getLettersOnlyMemberCode(27)).toBe('AA')
    expect(getLettersOnlyMemberCode(28)).toBe('AB')
  })

  it('generates the minimum three-digit numeric sequence and expands after 999', () => {
    expect(getNumbersOnlyMemberCode(1)).toBe('001')
    expect(getNumbersOnlyMemberCode(9)).toBe('009')
    expect(getNumbersOnlyMemberCode(10)).toBe('010')
    expect(getNumbersOnlyMemberCode(99)).toBe('099')
    expect(getNumbersOnlyMemberCode(100)).toBe('100')
    expect(getNumbersOnlyMemberCode(500)).toBe('500')
    expect(getNumbersOnlyMemberCode(999)).toBe('999')
    expect(getNumbersOnlyMemberCode(1000)).toBe('1000')
  })

  it('maps two toggles to one mutually-exclusive stored format', () => {
    expect(getToggledMemberCodeFormat(MEMBER_CODE_FORMATS.ALPHANUMERIC, MEMBER_CODE_FORMATS.LETTERS)).toBe(MEMBER_CODE_FORMATS.LETTERS)
    expect(getToggledMemberCodeFormat(MEMBER_CODE_FORMATS.LETTERS, MEMBER_CODE_FORMATS.NUMBERS)).toBe(MEMBER_CODE_FORMATS.NUMBERS)
    expect(getToggledMemberCodeFormat(MEMBER_CODE_FORMATS.NUMBERS, MEMBER_CODE_FORMATS.NUMBERS)).toBe(MEMBER_CODE_FORMATS.ALPHANUMERIC)
  })

  it('uses a persisted workspace assignment over a client fallback and retains aliases', () => {
    const members = [{ id: 'one', full_name: 'Esther M' }, { id: 'two', full_name: 'Beniah D' }]
    const map = buildMemberIndexCodeMap(members, {
      format: MEMBER_CODE_FORMATS.NUMBERS,
      persistedCodes: { one: { current_code: '041', aliases: ['E01'] } }
    })
    expect(getMemberIndexCode(members[0], map)).toBe('041')
    expect(getMemberIndexCode(members[1], map)).toBe('002')
    expect(getMemberIndexCodeAliases(members[0], map)).toEqual(['E01'])
  })
})
