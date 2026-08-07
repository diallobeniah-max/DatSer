import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHARE_MESSAGE_TEMPLATE,
  SHARE_MESSAGE_TOKENS,
  formatMemberCodeShareMessage
} from './memberCodeShareMessage'

describe('memberCodeShareMessage utility', () => {
  it('formats template with member name, first name, code, church name, and lookup link', () => {
    const template = 'Hello {first_name} ({name}), welcome to {church_name}. Code: {member_code}, Link: {lookup_link}'
    const member = { full_name: 'Ama Mensah' }
    const result = formatMemberCodeShareMessage({
      template,
      member,
      memberCode: '062',
      churchName: 'The Maker’s House',
      lookupLink: 'https://example.com/member/062'
    })

    expect(result).toBe('Hello Ama (Ama Mensah), welcome to The Maker’s House. Code: 062, Link: https://example.com/member/062')
  })

  it('keeps unknown placeholders intact', () => {
    const template = 'Hello {first_name}, your role is {unknown_role}.'
    const result = formatMemberCodeShareMessage({
      template,
      member: { full_name: 'John Doe' },
      memberCode: '123'
    })

    expect(result).toBe('Hello John, your role is {unknown_role}.')
  })

  it('supports legacy tokens {code}, {workspace}, {church}', () => {
    const template = 'Hi {name}. Welcome to {workspace}/{church}. Your pass is {code}.'
    const result = formatMemberCodeShareMessage({
      template,
      member: { full_name: 'Kofi Annan' },
      memberCode: '999',
      churchName: 'Faith Chapel'
    })

    expect(result).toBe('Hi Kofi Annan. Welcome to Faith Chapel/Faith Chapel. Your pass is 999.')
  })

  it('ensures bulk member messages do not leak data across members', () => {
    const template = 'Hi {first_name}, code is {member_code}.'
    const memberA = { full_name: 'Alice Smith' }
    const memberB = { full_name: 'Bob Jones' }

    const resA = formatMemberCodeShareMessage({ template, member: memberA, memberCode: 'A01' })
    const resB = formatMemberCodeShareMessage({ template, member: memberB, memberCode: 'B02' })

    expect(resA).toBe('Hi Alice, code is A01.')
    expect(resB).toBe('Hi Bob, code is B02.')
  })

  it('uses default template if template is empty', () => {
    const result = formatMemberCodeShareMessage({
      template: '',
      member: { full_name: 'Kwame Nkrumah' },
      memberCode: '001',
      churchName: 'Central Church'
    })

    expect(result).toContain('Hello Kwame,')
    expect(result).toContain('Thank you for joining Central Church.')
    expect(result).toContain('Your member code is 001.')
  })

  it('exports token list', () => {
    expect(SHARE_MESSAGE_TOKENS).toHaveLength(5)
    expect(SHARE_MESSAGE_TOKENS.map(t => t.token)).toEqual([
      '{name}',
      '{first_name}',
      '{member_code}',
      '{church_name}',
      '{lookup_link}'
    ])
  })
})
