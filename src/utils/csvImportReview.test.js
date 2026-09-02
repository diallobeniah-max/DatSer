import { describe, expect, it } from 'vitest'
import { filterCsvImportReviewRows, getCsvImportReviewStatusCounts, getCsvImportRowIssue, isCsvImportRowReady } from './csvImportReview'

const rows = [
  { importRowId: 'r1', match: { status: 'exact' }, saveStatus: 'saved' },
  { importRowId: 'r2', match: { status: 'possible' }, saveStatus: 'skipped' },
  { importRowId: 'r3', match: { status: 'possible' }, saveStatus: 'skipped' },
  { importRowId: 'r4', match: { status: 'new' }, saveStatus: 'failed' },
]

describe('CSV Import review projections', () => {
  it('counts matching and save outcomes independently without dropping canonical rows', () => {
    expect(getCsvImportReviewStatusCounts(rows)).toEqual({
      all: 4,
      exact: 1,
      possible: 2,
      new: 1,
      invalid: 0,
      saved: 1,
      skipped: 2,
      failed: 1,
      unmatched: 0,
      ready: 0,
      unresolved: 2,
      attention: 0,
    })
  })

  it.each([
    ['saved', ['r1']],
    ['skipped', ['r2', 'r3']],
    ['failed', ['r4']],
    ['possible', ['r2', 'r3']],
  ])('filters %s rows without mutating the canonical array', (filter, expected) => {
    const before = JSON.parse(JSON.stringify(rows))
    expect(filterCsvImportReviewRows(rows, filter).map((row) => row.importRowId)).toEqual(expected)
    expect(rows).toEqual(before)
  })

  it('projects names-only ready and unresolved states without changing rows', () => {
    const namesRows = [
      { importRowId: 'n1', match: { status: 'exact', selectedMemberId: 'm1' }, saveStatus: 'pending' },
      { importRowId: 'n2', match: { status: 'possible' }, saveStatus: 'pending' },
      { importRowId: 'n3', match: { status: 'unmatched' }, saveStatus: 'pending' },
      { importRowId: 'n4', duplicateOfRowId: 'n1', match: { status: 'exact', selectedMemberId: 'm1' }, saveStatus: 'pending' },
    ]
    expect(getCsvImportReviewStatusCounts(namesRows)).toMatchObject({ all: 4, ready: 1, unmatched: 1, unresolved: 2 })
    expect(filterCsvImportReviewRows(namesRows, 'ready').map((row) => row.importRowId)).toEqual(['n1'])
    expect(filterCsvImportReviewRows(namesRows, 'unresolved').map((row) => row.importRowId)).toEqual(['n2', 'n3'])
  })

  it('keeps clean exact rows out of the issue queue while retaining safety gates', () => {
    expect(getCsvImportRowIssue({ match: { status: 'exact', selectedMemberId: 'm1' }, saveStatus: 'pending' })).toBeNull()
    expect(isCsvImportRowReady({ match: { status: 'exact', selectedMemberId: 'm1' }, saveStatus: 'pending' })).toBe(true)
    expect(getCsvImportRowIssue({ match: { status: 'possible' }, saveStatus: 'pending' })).toMatchObject({ kind: 'possible' })
    expect(getCsvImportRowIssue({ match: { status: 'new' }, saveStatus: 'pending' })).toMatchObject({ kind: 'unmatched' })
    expect(getCsvImportRowIssue({ match: { status: 'exact' }, saveStatus: 'saved' })).toBeNull()
  })
})
