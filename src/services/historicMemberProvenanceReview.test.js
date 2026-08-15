import { describe, expect, it } from 'vitest'
import { groupHistoricProvenanceReview } from './historicMemberProvenanceReview'

describe('groupHistoricProvenanceReview', () => {
  it('collapses month copies into one operator decision and masks phones', () => {
    const result = groupHistoricProvenanceReview([
      { member_id: 'member-1', source_month: 'January_2026', display_name: 'Ada', phone_hint: '0244 123 456', reason: 'UNMAPPED' },
      { member_id: 'member-1', source_month: 'February_2026', display_name: 'Ada', phone_hint: '0244 123 456', reason: 'UNMAPPED' }
    ])
    expect(result).toEqual([expect.objectContaining({ memberId: 'member-1', rowInstances: 2, phoneHint: '***3456' })])
  })
})
