import { describe, expect, it } from 'vitest'
import {
  REVIEW_FILTERS,
  REVIEW_SORTS,
  buildPersonMeta,
  detectConflicts,
  filterReviewPersons,
  groupRecordsByIdentity,
  mostCompleteSingleRecord,
  normalizeReviewRow,
  recommendCombinedProfile,
  scoreCompleteness,
  sortReviewPersons,
  sortRecordsNewestFirst
} from './memberDataReview'

const rec = (overrides = {}) => {
  const merged = {
    id: 'id-1',
    canonicalId: 'uuid-101',
    sourceTable: 'January_2026',
    source_month_label: '',
    full_name: 'Beniah Opong',
    gender: 'Male',
    phone_number: '0244307261',
    age: '28',
    current_level: 'Tertiary',
    date_of_birth: '',
    parent_name_1: 'Ama Opong',
    parent_phone_1: '0241117261',
    parent_name_2: '',
    parent_phone_2: '',
    ministry: 'Youth',
    notes: '',
    is_visitor: false,
    member_code: 'B01',
    inserted_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    __owner_id: 'owner-1',
    ...overrides
  }
  merged.source_month_label = merged.source_month_label || merged.sourceTable.replace('_', ' ')
  return merged
}

describe('normalizeReviewRow', () => {
  it('maps PascalCase and snake_case month columns into a review record', () => {
    const row = {
      id: 'uuid-101',
      'Full Name': 'Beniah Opong',
      Gender: 'Male',
      'Phone Number': '024 430 7261',
      Age: '28',
      'Current Level': 'SHS 1',
      parent_name_1: 'Ama',
      parent_phone_1: '0241117261',
      ministry: 'Youth',
      is_visitor: true,
      date_of_birth: '1998-04-01',
      member_code: 'B01',
      inserted_at: '2026-01-05T00:00:00Z',
      updated_at: '2026-01-06T00:00:00Z'
    }
    const record = normalizeReviewRow(row, { tableName: 'January_2026' })
    expect(record.canonicalId).toBe('uuid-101')
    expect(record.sourceTable).toBe('January_2026')
    expect(record.source_month_label).toBe('January 2026')
    expect(record.full_name).toBe('Beniah Opong')
    expect(record.gender).toBe('Male')
    expect(record.phone_number).toBe('024 430 7261')
    expect(record.current_level).toBe('SHS 1')
    expect(record.is_visitor).toBe(true)
    expect(record.member_code).toBe('B01')
  })

  it('prefers the canonical code assignment over the row member_code', () => {
    const record = normalizeReviewRow({ id: 'uuid-101', member_code: 'OLD' }, {
      tableName: 'January_2026',
      codeAssignments: { 'uuid-101': { current_code: 'C42' } }
    })
    expect(record.member_code).toBe('C42')
  })

  it('returns null for malformed rows', () => {
    expect(normalizeReviewRow(null)).toBeNull()
    expect(normalizeReviewRow(undefined)).toBeNull()
    expect(normalizeReviewRow('row')).toBeNull()
  })
})

describe('groupRecordsByIdentity', () => {
  it('groups the same canonical UUID across months together', () => {
    const groups = groupRecordsByIdentity([
      rec({ id: 'a', canonicalId: 'uuid-101', sourceTable: 'January_2026' }),
      rec({ id: 'b', canonicalId: 'uuid-101', sourceTable: 'February_2026' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].recordCount).toBe(2)
    expect(groups[0].monthCount).toBe(2)
  })

  it('groups by the same canonical member code when no canonical id exists', () => {
    const groups = groupRecordsByIdentity([
      rec({ id: 'a', canonicalId: null, member_code: 'B07', sourceTable: 'January_2026' }),
      rec({ id: 'b', canonicalId: null, member_code: 'B07', sourceTable: 'March_2026' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].keyType).toBe('code')
    expect(groups[0].key).toBe('B07')
    expect(groups[0].recordCount).toBe(2)
  })

  it('keeps the same name with different canonical IDs as separate people', () => {
    const groups = groupRecordsByIdentity([
      rec({ id: 'a', canonicalId: 'uuid-1', full_name: 'John Doe', phone_number: '0241111111', sourceTable: 'January_2026' }),
      rec({ id: 'b', canonicalId: 'uuid-2', full_name: 'John Doe', phone_number: '0242222222', sourceTable: 'February_2026' })
    ])
    expect(groups).toHaveLength(2)
  })

  it('never merges different canonical IDs even when name and phone support', () => {
    const groups = groupRecordsByIdentity([
      rec({ id: 'a', canonicalId: 'uuid-1', full_name: 'John Doe', phone_number: '0241111111', gender: 'Male', age: '30', sourceTable: 'January_2026' }),
      rec({ id: 'b', canonicalId: 'uuid-2', full_name: 'John Doe', phone_number: '0241111111', gender: 'Male', age: '30', sourceTable: 'February_2026' })
    ])
    expect(groups).toHaveLength(2)
  })

  it('groups exact name plus supporting evidence when no canonical id exists', () => {
    const groups = groupRecordsByIdentity([
      rec({ id: 'a', canonicalId: null, full_name: 'Kofi Mensah', gender: 'Male', age: '25', member_code: '', phone_number: '', parent_phone_1: '', parent_phone_2: '', sourceTable: 'January_2026' }),
      rec({ id: 'b', canonicalId: null, full_name: 'Kofi Mensah', gender: 'Male', age: '25', member_code: '', phone_number: '', parent_phone_1: '', parent_phone_2: '', sourceTable: 'March_2026' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].keyType).toBe('name')
    expect(groups[0].uncertain).toBe(true)
  })

  it('keeps same-name records without supporting evidence separate and flagged', () => {
    const groups = groupRecordsByIdentity([
      rec({ id: 'a', canonicalId: null, full_name: 'Ama Serwaa', gender: '', age: '', phone_number: '', member_code: '', parent_phone_1: '', parent_phone_2: '', sourceTable: 'January_2026' }),
      rec({ id: 'b', canonicalId: null, full_name: 'Ama Serwaa', gender: '', age: '', phone_number: '', member_code: '', parent_phone_1: '', parent_phone_2: '', sourceTable: 'February_2026' })
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.uncertain)).toBe(true)
  })
})

describe('recommendCombinedProfile', () => {
  it('prefers the newest NON-EMPTY value for each field', () => {
    const older = rec({ id: 'a', sourceTable: 'January_2026', source_month_label: 'January 2026', updated_at: '2026-01-01T00:00:00Z', phone_number: '0241111111' })
    const newer = rec({ id: 'b', sourceTable: 'May_2026', source_month_label: 'May 2026', updated_at: '2026-05-01T00:00:00Z', phone_number: '', gender: 'Male' })
    const recommendation = recommendCombinedProfile([older, newer])
    expect(recommendation.combined.phone_number).toBe('0241111111')
    expect(recommendation.combined.gender).toBe('Male')
  })

  it('never lets a newer blank field erase an older useful value', () => {
    const older = rec({ id: 'a', sourceTable: 'January_2026', source_month_label: 'January 2026', updated_at: '2026-01-01T00:00:00Z', current_level: 'SHS 1' })
    const newer = rec({ id: 'b', sourceTable: 'June_2026', source_month_label: 'June 2026', updated_at: '2026-06-01T00:00:00Z', current_level: '' })
    const recommendation = recommendCombinedProfile([older, newer])
    expect(recommendation.combined.current_level).toBe('SHS 1')
  })

  it('retains provenance for every selected field', () => {
    const jan = rec({ id: 'a', sourceTable: 'January_2026', source_month_label: 'January 2026', updated_at: '2026-01-01T00:00:00Z', phone_number: '0241111111', current_level: '' })
    const jun = rec({ id: 'b', sourceTable: 'June_2026', source_month_label: 'June 2026', updated_at: '2026-06-01T00:00:00Z', phone_number: '', current_level: 'SHS 1' })
    const recommendation = recommendCombinedProfile([jan, jun])
    expect(recommendation.provenance.phone_number.sourceMonth).toBe('January 2026')
    expect(recommendation.provenance.current_level.sourceMonth).toBe('June 2026')
    expect(recommendation.label).toBe('Details combined through June 2026')
  })

  it('computes the most complete single record separately from the combined profile', () => {
    const sparse = rec({ id: 'a', sourceTable: 'January_2026', updated_at: '2026-06-01T00:00:00Z', full_name: 'X', gender: '', phone_number: '', age: '', current_level: '', date_of_birth: '', parent_name_1: '', parent_phone_1: '', parent_name_2: '', parent_phone_2: '', ministry: '', notes: '', member_code: '' })
    const complete = rec({ id: 'b', sourceTable: 'February_2026', updated_at: '2026-01-01T00:00:00Z', full_name: 'X Y Z', gender: 'Male', phone_number: '0241111111', age: '30', current_level: 'Tertiary', date_of_birth: '1996-01-01', parent_name_1: 'A', parent_phone_1: '0242222222', parent_name_2: 'B', parent_phone_2: '0243333333', ministry: 'Youth', notes: 'note', member_code: 'B01' })
    const mostComplete = mostCompleteSingleRecord([sparse, complete])
    expect(mostComplete.id).toBe(complete.id)
  })
})

describe('detectConflicts', () => {
  it('flags differing phone numbers with month provenance', () => {
    const conflicts = detectConflicts([
      rec({ id: 'a', sourceTable: 'January_2026', source_month_label: 'January 2026', phone_number: '0241111111' }),
      rec({ id: 'b', sourceTable: 'June_2026', source_month_label: 'June 2026', phone_number: '0242222222' })
    ])
    const phone = conflicts.find((c) => c.field === 'phone_number')
    expect(phone).toBeTruthy()
    expect(phone.values).toHaveLength(2)
    expect(phone.values[0].months).toContain('January 2026')
    expect(phone.values[1].months).toContain('June 2026')
  })

  it('flags conflicting canonical ids as an identity conflict', () => {
    const conflicts = detectConflicts([
      rec({ id: 'a', canonicalId: 'uuid-1' }),
      rec({ id: 'b', canonicalId: 'uuid-2' })
    ])
    expect(conflicts.some((c) => c.kind === 'identity')).toBe(true)
  })

  it('does not flag harmless field variance such as current level', () => {
    const conflicts = detectConflicts([
      rec({ id: 'a', sourceTable: 'January_2026', current_level: 'SHS 1' }),
      rec({ id: 'b', sourceTable: 'June_2026', current_level: 'SHS 2' })
    ])
    expect(conflicts.some((c) => c.field === 'current_level')).toBe(false)
  })

  it('does not treat phone formatting differences as a conflict', () => {
    const conflicts = detectConflicts([
      rec({ id: 'a', sourceTable: 'January_2026', phone_number: '024 111 1111' }),
      rec({ id: 'b', sourceTable: 'June_2026', phone_number: '0241111111' })
    ])
    expect(conflicts.some((c) => c.field === 'phone_number')).toBe(false)
  })
})

describe('scoreCompleteness', () => {
  it('scores the number of useful profile fields deterministically', () => {
    const complete = rec({ full_name: 'A', gender: 'Male', phone_number: '0241111111', age: '30', current_level: 'X', date_of_birth: '2000-01-01', parent_name_1: 'A', parent_phone_1: '0242222222', parent_name_2: 'B', parent_phone_2: '0243333333', ministry: 'Y', notes: 'n', member_code: 'B01' })
    const empty = rec({ full_name: '', gender: '', phone_number: '', age: '', current_level: '', date_of_birth: '', parent_name_1: '', parent_phone_1: '', parent_name_2: '', parent_phone_2: '', ministry: '', notes: '', member_code: '' })
    expect(scoreCompleteness(complete).percent).toBe(1)
    expect(scoreCompleteness(complete).count).toBe(13)
    expect(scoreCompleteness(empty).count).toBe(0)
    expect(scoreCompleteness(empty).missingFields).toHaveLength(13)
  })
})

describe('sortRecordsNewestFirst', () => {
  it('orders newer timestamps first', () => {
    const older = rec({ id: 'a', updated_at: '2026-01-01T00:00:00Z' })
    const newer = rec({ id: 'b', updated_at: '2026-06-01T00:00:00Z' })
    expect(sortRecordsNewestFirst([older, newer]).map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('buildPersonMeta', () => {
  it('aggregates name, code, months, completeness and conflicts for a person', () => {
    const person = buildPersonMeta([
      rec({ id: 'a', sourceTable: 'January_2026', source_month_label: 'January 2026', updated_at: '2026-01-01T00:00:00Z' }),
      rec({ id: 'b', sourceTable: 'May_2026', source_month_label: 'May 2026', updated_at: '2026-05-01T00:00:00Z' })
    ])
    expect(person.name).toBe('Beniah Opong')
    expect(person.code).toBe('B01')
    expect(person.monthCount).toBe(2)
    expect(person.recordCount).toBe(2)
    expect(person.keyType).toBe('uuid')
    expect(person.uncertain).toBe(false)
    expect(person.latestUpdate).toBe('2026-05-01T00:00:00Z')
  })
})

describe('filterReviewPersons and sortReviewPersons', () => {
  const persons = [
    buildPersonMeta([rec({ id: 'a', canonicalId: 'uuid-1', full_name: 'Alice', member_code: 'A01', updated_at: '2026-01-01T00:00:00Z', sourceTable: 'January_2026' })]),
    buildPersonMeta([
      rec({ id: 'b', canonicalId: 'uuid-2', full_name: 'Bob', member_code: 'B01', phone_number: '0241111111', updated_at: '2026-01-01T00:00:00Z', sourceTable: 'January_2026' }),
      rec({ id: 'c', canonicalId: 'uuid-2', full_name: 'Bob', member_code: 'B01', phone_number: '0242222222', updated_at: '2026-06-01T00:00:00Z', sourceTable: 'June_2026' })
    ]),
    buildPersonMeta([rec({ id: 'd', canonicalId: null, full_name: 'Uncertain Name', member_code: '', phone_number: '', parent_phone_1: '', parent_phone_2: '', updated_at: '2026-03-01T00:00:00Z', sourceTable: 'March_2026' })])
  ]

  it('filters by needs-review (conflicts or uncertain)', () => {
    const filtered = filterReviewPersons(persons, { filter: REVIEW_FILTERS.NEEDS_REVIEW })
    expect(filtered.map((p) => p.name).sort()).toEqual(['Bob', 'Uncertain Name'])
  })

  it('filters by conflicts', () => {
    const filtered = filterReviewPersons(persons, { filter: REVIEW_FILTERS.CONFLICTS })
    expect(filtered.map((p) => p.name)).toEqual(['Bob'])
  })

  it('filters by multiple months', () => {
    const filtered = filterReviewPersons(persons, { filter: REVIEW_FILTERS.MULTIPLE_MONTHS })
    expect(filtered.map((p) => p.name)).toEqual(['Bob'])
  })

  it('filters by query text and code', () => {
    expect(filterReviewPersons(persons, { query: 'bob' }).map((p) => p.name)).toEqual(['Bob'])
    expect(filterReviewPersons(persons, { query: 'A01' }).map((p) => p.name)).toEqual(['Alice'])
  })

  it('sorts by completeness, months, recency and name', () => {
    const byCompleteness = sortReviewPersons(persons, { sortBy: REVIEW_SORTS.COMPLETENESS, direction: 'desc' })
    expect(byCompleteness[0].name).toBe('Bob')

    const byMonths = sortReviewPersons(persons, { sortBy: REVIEW_SORTS.MONTHS, direction: 'desc' })
    expect(byMonths[0].name).toBe('Bob')

    const byRecent = sortReviewPersons(persons, { sortBy: REVIEW_SORTS.RECENT, direction: 'desc' })
    expect(byRecent[0].name).toBe('Bob')

    const byName = sortReviewPersons(persons, { sortBy: REVIEW_SORTS.NAME, direction: 'asc' })
    expect(byName.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Uncertain Name'])
  })
})
