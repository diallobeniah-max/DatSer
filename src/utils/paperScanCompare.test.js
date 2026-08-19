import { describe, expect, it } from 'vitest'
import {
  COMPARE_FIELDS,
  FIELD_STATES,
  MATCH_STATUSES,
  REVIEW_SOURCES,
  compareFieldValue,
  compareRowToMember,
  fieldNeedsDecision,
  getCrossMonthMatchCandidates,
  getEffectiveValue,
  getExistingValue,
  matchGeminiRowToMember,
  namesEquivalent,
  normalizeGenderForCompare,
  normalizeLevelForCompare,
  phonesEquivalent,
  summarizeRowCompare
} from './paperScanCompare'

describe('paperScanCompare field values', () => {
  it('reads existing values from snake_case or Title Case member columns', () => {
    expect(getExistingValue({ phone_number: '0241111111' }, 'phone_number')).toBe('0241111111')
    expect(getExistingValue({ 'Phone Number': '0242222222' }, 'phone_number')).toBe('0242222222')
    expect(getExistingValue({}, 'phone_number')).toBe('')
  })

  it('treats names that differ only in case, spacing, or accents as the same', () => {
    expect(namesEquivalent('Ama Serwaa', 'ama serwaa')).toBe(true)
    expect(namesEquivalent('José Kofi', 'jose kofi')).toBe(true)
    expect(namesEquivalent('Ama', 'Aba')).toBe(false)
  })

  it('treats phone variants with the same digits as equivalent', () => {
    expect(phonesEquivalent('024 111 1111', '0241111111')).toBe(true)
    expect(phonesEquivalent('0241111111', '233241111111')).toBe(true)
    expect(phonesEquivalent('0241111111', '0242222222')).toBe(false)
  })

  it('normalizes gender case-insensitively', () => {
    expect(normalizeGenderForCompare(' FEMALE ')).toBe('female')
    expect(normalizeGenderForCompare('female')).toBe('female')
  })

  it('normalizes levels conservatively without inventing equivalences', () => {
    expect(normalizeLevelForCompare('SHS 1')).toBe('SHS1')
    expect(normalizeLevelForCompare('shs1')).toBe('SHS1')
    expect(normalizeLevelForCompare('JHS-3')).toBe('JHS3')
    expect(normalizeLevelForCompare('Tertiary')).not.toBe(normalizeLevelForCompare('University'))
  })

  it('classifies fields as same, different, missing, or low-confidence', () => {
    expect(compareFieldValue({ field: 'full_name', geminiValue: 'Ama', existingValue: 'ama' }).state).toBe(FIELD_STATES.SAME)
    expect(compareFieldValue({ field: 'gender', geminiValue: 'FEMALE', existingValue: 'female' }).state).toBe(FIELD_STATES.SAME)
    expect(compareFieldValue({ field: 'current_level', geminiValue: 'SHS 1', existingValue: 'SHS1' }).state).toBe(FIELD_STATES.SAME)
    expect(compareFieldValue({ field: 'full_name', geminiValue: 'Ama', existingValue: 'Aba' }).state).toBe(FIELD_STATES.DIFFERENT)
    expect(compareFieldValue({ field: 'phone_number', geminiValue: '0241111111', existingValue: '0249999999' }).state).toBe(FIELD_STATES.DIFFERENT)
    expect(compareFieldValue({ field: 'full_name', geminiValue: 'Ama', existingValue: 'Aba', confidence: 0.3 }).state).toBe(FIELD_STATES.LOW_CONFIDENCE)
    expect(compareFieldValue({ field: 'full_name', geminiValue: 'Ama', existingValue: 'Ama', confidence: 0.2 }).state).toBe(FIELD_STATES.SAME)
    expect(compareFieldValue({ field: 'full_name', geminiValue: '', existingValue: 'Ama' }).state).toBe(FIELD_STATES.MISSING)
    expect(compareFieldValue({ field: 'parent_name_1', geminiValue: '', existingValue: 'Ama' }).state).toBe(FIELD_STATES.MISSING)
    expect(compareFieldValue({ field: 'parent_phone_1', geminiValue: '0240000000', existingValue: '233240000000' }).state).toBe(FIELD_STATES.SAME)
    expect(compareFieldValue({ field: 'full_name', geminiValue: 'Ama', existingValue: '' }).state).toBe(FIELD_STATES.DIFFERENT)
  })

  it('only flags decisions for different or low-confidence fields', () => {
    expect(fieldNeedsDecision({ state: FIELD_STATES.DIFFERENT })).toBe(true)
    expect(fieldNeedsDecision({ state: FIELD_STATES.LOW_CONFIDENCE })).toBe(true)
    expect(fieldNeedsDecision({ state: FIELD_STATES.SAME })).toBe(false)
    expect(fieldNeedsDecision({ state: FIELD_STATES.MISSING })).toBe(false)
  })
})

describe('paperScanCompare row matching', () => {
  const members = [
    { id: '1', full_name: 'Ama Serwaa', phone_number: '0241111111', 'Current Level': 'SHS1', Gender: 'Female' },
    { id: '2', full_name: 'Kwame Mensah', phone_number: '0242222222' },
    { id: '3', full_name: 'Efua Koomson', phone_number: '0243333333' }
  ]

  it('matches an exact phone to the id column source', () => {
    const result = matchGeminiRowToMember({ full_name: 'Ama', phone_number: '233241111111' }, members)
    expect(result.status).toBe(MATCH_STATUSES.MATCHED)
    expect(result.member.id).toBe('1')
  })

  it('matches an exact normalized name', () => {
    const result = matchGeminiRowToMember({ full_name: 'kwame mensah' }, members)
    expect(result.status).toBe(MATCH_STATUSES.MATCHED)
    expect(result.member.id).toBe('2')
  })

  it('reports a possible match for a partial name', () => {
    const result = matchGeminiRowToMember({ full_name: 'Efua K' }, members)
    expect(result.status).toBe(MATCH_STATUSES.POSSIBLE)
    expect(result.member.id).toBe('3')
  })

  it('reports a possible match when several members are exact', () => {
    const twins = [...members, { id: '4', full_name: 'Kwame Mensah', phone_number: '0244444444' }]
    const result = matchGeminiRowToMember({ full_name: 'Kwame Mensah' }, twins)
    expect(result.status).toBe(MATCH_STATUSES.POSSIBLE)
    expect(result.reason).toBe('ambiguous')
  })

  it('reports no match when nothing identifies the row', () => {
    expect(matchGeminiRowToMember({}, members).status).toBe(MATCH_STATUSES.NONE)
    expect(matchGeminiRowToMember({ full_name: 'Nobody Here' }, members).status).toBe(MATCH_STATUSES.NONE)
    expect(matchGeminiRowToMember({ full_name: 'Ama' }, []).status).toBe(MATCH_STATUSES.NONE)
  })
})

describe('paperScanCompare row summaries and decisions', () => {
  const member = { id: '1', full_name: 'Ama Serwaa', phone_number: '0241111111', Gender: 'Female' }
  const row = { full_name: 'Ama Serwaa', phone_number: '0249999999', gender: 'F', current_level: '', confidence: 0.9 }

  it('summarizes per-field states and unresolved decisions', () => {
    const summary = summarizeRowCompare(row, member)
    const byField = Object.fromEntries(summary.compares.map((compare) => [compare.field, compare.state]))
    expect(byField.full_name).toBe(FIELD_STATES.SAME)
    expect(byField.phone_number).toBe(FIELD_STATES.DIFFERENT)
    expect(byField.gender).toBe(FIELD_STATES.DIFFERENT)
    expect(byField.current_level).toBe(FIELD_STATES.MISSING)
    expect(summary.totals.unresolved).toBe(2)
    expect(summary.totals.resolved).toBe(0)
  })

  it('resolves decisions via Use Scan, Keep DatSer, or Edit', () => {
    const decided = {
      ...row,
      reviewedValues: {
        phone_number: { value: '0249999999', source: REVIEW_SOURCES.SCAN },
        gender: { value: 'Female', source: REVIEW_SOURCES.DATSER }
      }
    }
    const summary = summarizeRowCompare(decided, member)
    expect(summary.totals.unresolved).toBe(0)
    expect(summary.totals.resolved).toBe(2)
    const phoneCompare = summary.compares.find((compare) => compare.field === 'phone_number')
    const genderCompare = summary.compares.find((compare) => compare.field === 'gender')
    expect(getEffectiveValue({ field: 'phone_number', compare: phoneCompare, row: decided, member })).toBe('0249999999')
    expect(getEffectiveValue({ field: 'gender', compare: genderCompare, row: decided, member })).toBe('Female')
  })

  it('falls back to the existing value for same or missing fields', () => {
    const summary = summarizeRowCompare(row, member)
    expect(getEffectiveValue({ field: 'full_name', compare: summary.compares[0], row, member })).toBe('Ama Serwaa')
    const levelCompare = summary.compares.find((compare) => compare.field === 'current_level')
    expect(getEffectiveValue({ field: 'current_level', compare: levelCompare, row, member })).toBe('')
  })

  it('applies an edited value over both sources', () => {
    const edited = {
      ...row,
      reviewedValues: { full_name: { value: 'Ama S. Serwaa', source: REVIEW_SOURCES.EDITED } }
    }
    const summary = summarizeRowCompare(edited, member)
    expect(getEffectiveValue({ field: 'full_name', compare: summary.compares[0], row: edited, member })).toBe('Ama S. Serwaa')
  })

  it('provides stable field metadata for the UI', () => {
    expect(COMPARE_FIELDS.map((field) => field.key)).toEqual(['full_name', 'phone_number', 'age', 'gender', 'current_level', 'parent_name_1', 'parent_phone_1'])
    const level = COMPARE_FIELDS.find((field) => field.key === 'current_level')
    expect(level.label).toBe('Level of Education')
    const phone = COMPARE_FIELDS.find((field) => field.key === 'phone_number')
    expect(phone.label).toBe('Phone Number')
    const parentName = COMPARE_FIELDS.find((field) => field.key === 'parent_name_1')
    expect(parentName.label).toBe('Parent/Guardian Name')
  })
})

describe('paperScanCompare row comparison to member', () => {
  it('compares every compare field against the member columns', () => {
    const member = { full_name: 'Ama Serwaa', phone_number: '0241111111', gender: 'Female', age: '13', current_level: 'SHS 1', parent_name_1: 'Ama', parent_phone_1: '0240000000' }
    const compares = compareRowToMember({ full_name: 'ama serwaa', phone_number: '233241111111', gender: 'female', age: '13', current_level: 'SHS1', parent_name_1: 'ama', parent_phone_1: '0240000000', confidence: 0.95 }, member)
    expect(compares.every((compare) => compare.state === FIELD_STATES.SAME)).toBe(true)
    expect(compares).toHaveLength(7)
  })
})

describe('paperScanCompare cross-month Possible Matches', () => {
  it('surfaces a member found in another month instead of treating them as new', () => {
    const row = { full_name: 'Michelle Appiah Kusi', phone_number: '0208499198' }
    const crossMonthRows = [{
      member: { id: 'july-member', full_name: 'Michelle Appiah Kusi', phone_number: '0208499198', 'Current Level': 'SHS2' },
      source_table: 'July_2026',
      source_month_label: 'July 2026'
    }]
    const candidates = getCrossMonthMatchCandidates(row, crossMonthRows)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0].member.id).toBe('july-member')
    expect(candidates[0].sourceMonthLabel).toBe('July 2026')
    expect(candidates[0].sourceTable).toBe('July_2026')
  })

  it('returns nothing when no cross-month row matches', () => {
    const row = { full_name: 'Nobody Here', phone_number: '0299999999' }
    const crossMonthRows = [{
      member: { id: 'july-member', full_name: 'Someone Else', phone_number: '0200000000' },
      source_table: 'July_2026',
      source_month_label: 'July 2026'
    }]
    expect(getCrossMonthMatchCandidates(row, crossMonthRows)).toEqual([])
  })

  it('flags a shared-phone candidate without auto-merging two distinct people', () => {
    // Family shares 0557204188 but the scanned person has a different name.
    const row = { full_name: 'Gloria Orakposim', phone_number: '0557204188' }
    const crossMonthRows = [{
      member: { id: 'family-member', full_name: 'Michelle Orakposim', phone_number: '0557204188' },
      source_table: 'January_2026',
      source_month_label: 'January 2026'
    }]
    const candidates = getCrossMonthMatchCandidates(row, crossMonthRows)
    // The phone-only candidate may be surfaced for review (a candidate list is
    // never a merge), but it must NOT be treated as an exact NAME match that
    // auto-resolves two distinct people into one.
    const nameExactMerge = candidates.some((candidate) => (
      candidate.member.id === 'family-member' && candidate.reason === 'exact' && candidate.query === row.full_name
    ))
    expect(nameExactMerge).toBe(false)
    // And the helper itself never mutates or merges: it only returns a read-only list.
    expect(crossMonthRows[0].member.id).toBe('family-member')
    expect(row.full_name).toBe('Gloria Orakposim')
  })
})