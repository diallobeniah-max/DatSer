import { describe, expect, it } from 'vitest'
import {
  attachMemberIdentity,
  buildMemberIdentityHint,
  getMemberSourceTable
} from './memberIdentity'

describe('member identity helpers', () => {
  it('keeps the original month table when the active month changes', () => {
    const member = attachMemberIdentity({ id: 'member-1', 'Full Name': 'Test Member' }, {
      tableName: 'July_2026',
      ownerId: 'owner-1'
    })

    expect(getMemberSourceTable(member, 'August_2026')).toBe('July_2026')
    expect(member.__owner_id).toBe('owner-1')
  })

  it('builds a minimal bounded lookup hint without unrelated form data', () => {
    expect(buildMemberIdentityHint({
      full_name: '  Test Member  ',
      'Phone Number': ' 0244000000 ',
      notes: 'must not be included'
    })).toEqual({
      full_name: 'Test Member',
      phone_number: '0244000000'
    })
  })
})
