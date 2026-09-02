import { describe, expect, it } from 'vitest'
import { CSV_IMPORT_REVIEW_COLUMNS, getCsvImportReviewColumnMinimum, getCsvImportReviewColumnWidth, getCsvImportReviewColumns } from './csvImportReviewLayout'

describe('CSV import review compact layout', () => {
  it('uses a dedicated dense profile without low-frequency guardian columns', () => {
    const columns = getCsvImportReviewColumns({ compactView: true, parsedSheets: ['Sheet 1'], sheetFilter: 'Sheet 1' })
    expect(columns.map((column) => column.key)).toEqual(expect.arrayContaining(['fullName', 'match', 'status', 'phoneNumber', 'age', 'gender', 'educationalLevel', 'sunday_1', 'sunday_5', 'actions']))
    expect(columns.map((column) => column.key)).not.toEqual(expect.arrayContaining(['sheet', 'parentGuardianName', 'parentGuardianPhone']))
  })

  it('keeps sheet context for mixed-sheet compact review', () => {
    const columns = getCsvImportReviewColumns({ compactView: true, parsedSheets: ['Sheet 1', 'Sheet 2'], sheetFilter: 'all' })
    expect(columns.find((column) => column.key === 'sheet')).toBeTruthy()
  })

  it('restores the fuller comfortable spreadsheet profile', () => {
    const columns = getCsvImportReviewColumns({ compactView: false, parsedSheets: ['Sheet 1'], sheetFilter: 'Sheet 1' })
    expect(columns).toEqual(CSV_IMPORT_REVIEW_COLUMNS)
    expect(columns.find((column) => column.key === 'parentGuardianName')).toBeTruthy()
  })

  it('provides genuinely tighter compact defaults and resize minimums', () => {
    const name = CSV_IMPORT_REVIEW_COLUMNS.find((column) => column.key === 'fullName')
    const sunday = CSV_IMPORT_REVIEW_COLUMNS.find((column) => column.key === 'sunday_1')
    expect(getCsvImportReviewColumnWidth(name, true)).toBeLessThan(getCsvImportReviewColumnWidth(name, false))
    expect(getCsvImportReviewColumnMinimum(sunday, true)).toBeLessThan(getCsvImportReviewColumnMinimum(sunday, false))
  })
})
