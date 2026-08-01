import { describe, expect, it } from 'vitest'
import {
  MEMBER_CODE_FORMATS,
  DEFAULT_MEMBER_CODE_LENGTH,
  buildMemberIndexCodeMap,
  getAlphanumericMemberCode,
  getMemberCodeCapacity,
  getLettersOnlyMemberCode,
  getMemberIndexCode,
  getMemberIndexCodeAliases,
  getNumbersOnlyMemberCode,
  getToggledMemberCodeFormat
} from './memberIndexCodes'

describe('workspace member-code formats', () => {
  it('generates fixed-width base-26 letter codes', () => {
    expect(getLettersOnlyMemberCode(1)).toBe('AAA')
    expect(getLettersOnlyMemberCode(2)).toBe('AAB')
    expect(getLettersOnlyMemberCode(26)).toBe('AAZ')
    expect(getLettersOnlyMemberCode(27)).toBe('ABA')
    expect(getLettersOnlyMemberCode(1, 4)).toBe('AAAA')
  })

  it('generates fixed-width numeric sequences without assigning zero', () => {
    expect(getNumbersOnlyMemberCode(1)).toBe('001')
    expect(getNumbersOnlyMemberCode(9)).toBe('009')
    expect(getNumbersOnlyMemberCode(10)).toBe('010')
    expect(getNumbersOnlyMemberCode(99)).toBe('099')
    expect(getNumbersOnlyMemberCode(100)).toBe('100')
    expect(getNumbersOnlyMemberCode(500)).toBe('500')
    expect(getNumbersOnlyMemberCode(999)).toBe('999')
    expect(getNumbersOnlyMemberCode(1000)).toBe('')
    expect(getNumbersOnlyMemberCode(1000, 4)).toBe('1000')
    expect(getNumbersOnlyMemberCode(0)).toBe('')
  })

  it('uses the selected length for all workspace formats and exposes capacity', () => {
    expect(DEFAULT_MEMBER_CODE_LENGTH).toBe(3)
    expect(getAlphanumericMemberCode(2, 3)).toBe('A02')
    expect(getAlphanumericMemberCode(2, 4)).toBe('A002')
    expect(getMemberCodeCapacity(MEMBER_CODE_FORMATS.NUMBERS, 3)).toBe(999)
    expect(getMemberCodeCapacity(MEMBER_CODE_FORMATS.LETTERS, 3)).toBe(17576)
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
      codeLength: 3,
      persistedCodes: { one: { current_code: '041', aliases: ['E01'] } }
    })
    expect(getMemberIndexCode(members[0], map)).toBe('041')
    expect(getMemberIndexCode(members[1], map)).toBe('002')
    expect(getMemberIndexCodeAliases(members[0], map)).toEqual(['E01'])
  })
})
