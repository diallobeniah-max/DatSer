import { describe, expect, it } from 'vitest'
import { parseCSVText, CSV_IMPORT_MODE } from './csvImportParser'
import {
  filterCsvImportReviewRows,
  getCsvImportNote,
  getCsvImportReviewStatusCounts,
  getCsvImportUnresolvedAttentionCount,
  hasCsvImportAttentionNote,
  isCsvImportAttentionUnresolved,
  markCsvImportAttentionVerified,
  searchCsvImportReviewRows,
} from './csvImportReview'
import { getCsvBatchEntryAttentionCount } from './csvImportBatch'
import { buildCsvPreviewSummary, buildCsvSavePlan, buildSundayNamesSavePlan } from '../services/csvImportSave'

const row = (id, notes = '', extra = {}) => ({
  importRowId: id,
  sheet: 'Sheet 1',
  rowNumber: Number(id.replace(/\D/g, '')) || 1,
  edited: {
    fullName: `Synthetic ${id}`,
    phoneNumber: '0240000000',
    memberCode: '',
    age: '14',
    gender: 'Female',
    educationalLevel: 'JHS 3',
    parentGuardianName: '',
    parentGuardianPhone: '',
    notes,
    sunday_1: 'PRESENT', sunday_2: '', sunday_3: '', sunday_4: '', sunday_5: '',
  },
  raw: { notes },
  match: { status: 'new', selectedMemberId: null, matchedMember: null },
  fieldResolution: {},
  saveStatus: 'pending',
  attentionVerified: false,
  ...extra,
})

describe('CSV Import Needs Attention workflow', () => {
  it('1. leaves empty notes outside attention', () => expect(hasCsvImportAttentionNote(row('r1'))).toBe(false))

  it('2. flags a non-empty transcription note', () => expect(isCsvImportAttentionUnresolved(row('r2', 'Phone unreadable'))).toBe(true))

  it('3. ignores whitespace-only notes', () => expect(isCsvImportAttentionUnresolved(row('r3', '   \t '))).toBe(false))

  it('4. counts only unresolved attention rows', () => {
    expect(getCsvImportUnresolvedAttentionCount([row('r1'), row('r2', 'Review'), row('r3', 'Done', { attentionVerified: true })])).toBe(1)
  })

  it('5. filters only unresolved attention rows', () => {
    expect(filterCsvImportReviewRows([row('r1'), row('r2', 'Review'), row('r3', 'Done', { attentionVerified: true })], 'attention').map((item) => item.importRowId)).toEqual(['r2'])
  })

  it('6. attention filtering never mutates or removes canonical rows', () => {
    const canonical = [row('r1'), row('r2', 'Review')]
    const snapshot = JSON.parse(JSON.stringify(canonical))
    expect(filterCsvImportReviewRows(canonical, 'attention')).toHaveLength(1)
    expect(canonical).toEqual(snapshot)
    expect(canonical).toHaveLength(2)
  })

  it('7. Mark Verified removes the row from attention projections', () => {
    const verified = markCsvImportAttentionVerified([row('r1', 'Review')], 'r1')
    expect(filterCsvImportReviewRows(verified, 'attention')).toEqual([])
    expect(getCsvImportReviewStatusCounts(verified).attention).toBe(0)
  })

  it('8. Mark Verified preserves the original note and matching status', () => {
    const source = row('r1', 'Surname spelling should be reviewed', { match: { status: 'possible' } })
    const [verified] = markCsvImportAttentionVerified([source], 'r1')
    expect(getCsvImportNote(verified)).toBe('Surname spelling should be reviewed')
    expect(verified.match.status).toBe('possible')
  })

  it('9. editing another field does not automatically verify attention', () => {
    const source = row('r1', 'Check phone')
    const edited = { ...source, edited: { ...source.edited, phoneNumber: '0550000000' } }
    expect(isCsvImportAttentionUnresolved(edited)).toBe(true)
  })

  it('10. Save Preview reports attention and excludes it from actionable rows', () => {
    const summary = buildCsvPreviewSummary({ importRows: [row('r1', 'Review'), row('r2')], sundayDateMap: {}, targetTable: 'August_2026' })
    expect(summary).toMatchObject({ totalRows: 2, attentionCount: 1, actionableCount: 1 })
  })

  it('11. final save plans gate an unresolved attention row explicitly', () => {
    const [step] = buildCsvSavePlan({ importRows: [row('r1', 'Review')], targetTable: 'August_2026', sundayDateMap: {}, ownerId: 'owner', workspaceName: 'Synthetic' })
    expect(step).toMatchObject({ action: 'unresolved', reason: expect.stringContaining('verification') })
  })

  it('12. saved JSON round-trips verification state and note text', () => {
    const [verified] = markCsvImportAttentionVerified([row('r1', 'Audit text')], 'r1')
    const [reopened] = JSON.parse(JSON.stringify([verified]))
    expect(reopened).toMatchObject({ attentionVerified: true, edited: { notes: 'Audit text' } })
    expect(isCsvImportAttentionUnresolved(reopened)).toBe(false)
  })

  it('13. batch sheet projections expose their own attention count', () => {
    expect(getCsvBatchEntryAttentionCount({ rows: [row('r1', 'Review'), row('r2'), row('r3', 'Check')] })).toBe(2)
  })

  it('14. a plain Full Register row keeps its existing save eligibility', () => {
    const [step] = buildCsvSavePlan({ importRows: [row('r1')], targetTable: 'August_2026', sundayDateMap: {}, ownerId: 'owner', workspaceName: 'Synthetic' })
    expect(step.action).toBe('create')
  })

  it('15. Sunday Names rows keep matching semantics while notes add a separate gate', () => {
    const member = { id: 'm1', 'Full Name': 'Synthetic r1', __source_table: 'August_2026' }
    const plain = row('r1', '', { mode: CSV_IMPORT_MODE.SUNDAY_NAMES, match: { status: 'exact', selectedMemberId: 'm1', matchedMember: member } })
    const flagged = row('r2', 'Name spelling', { mode: CSV_IMPORT_MODE.SUNDAY_NAMES, match: { status: 'exact', selectedMemberId: 'm1', matchedMember: member } })
    const plan = buildSundayNamesSavePlan({ importRows: [plain, flagged], targetTable: 'August_2026', selectedSundayDate: '2026-08-02', ownerId: 'owner', workspaceName: 'Synthetic' })
    expect(plan.map((step) => step.action)).toEqual(['update', 'unresolved'])
    expect(flagged.match.status).toBe('exact')
  })

  it('16. search composes with the attention filter', () => {
    const attentionRows = filterCsvImportReviewRows([row('r1', 'Phone review'), row('r2', 'Surname review'), row('r3')], 'attention')
    expect(searchCsvImportReviewRows(attentionRows, 'Synthetic r2').map((item) => item.importRowId)).toEqual(['r2'])
    expect(searchCsvImportReviewRows(attentionRows, '')).toHaveLength(2)
  })

  it('parsing initializes deterministic attention metadata without changing notes', () => {
    const parsed = parseCSVText('full_name,notes\nSynthetic Person,Phone unreadable', 'attention')
    expect(parsed.rows[0]).toMatchObject({ attentionVerified: false, edited: { notes: 'Phone unreadable' } })
  })
})
