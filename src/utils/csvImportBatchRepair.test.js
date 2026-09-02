import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AFFECTED_REPAIR_SHEETS,
  extractSheetNumber,
  isEntryInRepairList,
  prepareCsvBatchForReprocess,
} from './csvImportBatchRepair'
import { getCsvBatchReviewSummary, CSV_BATCH_STATUS } from './csvImportBatch'

describe('csvImportBatchRepair', () => {
  it('extracts sheet numbers correctly from various display basenames', () => {
    expect(extractSheetNumber('Sheet 5')).toBe(5)
    expect(extractSheetNumber('Sheet 05')).toBe(5)
    expect(extractSheetNumber('Sheet 17.csv')).toBe(17)
    expect(extractSheetNumber('august_sheet_20')).toBe(20)
    expect(extractSheetNumber(null, 3)).toBe(4)
  })

  it('matches only entries in the repair list', () => {
    expect(isEntryInRepairList({ displayBasename: 'Sheet 1' })).toBe(false)
    expect(isEntryInRepairList({ displayBasename: 'Sheet 4' })).toBe(false)
    expect(isEntryInRepairList({ displayBasename: 'Sheet 5' })).toBe(true)
    expect(isEntryInRepairList({ displayBasename: 'Sheet 10' })).toBe(true)
    expect(isEntryInRepairList({ displayBasename: 'Sheet 17' })).toBe(true)
    expect(isEntryInRepairList({ displayBasename: 'Sheet 20' })).toBe(true)
  })

  it('resets only affected 10 sheets and keeps Sheets 1-4 completed', () => {
    // Construct synthetic 14-sheet batch
    const sheetNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20]
    const syntheticBatch = sheetNumbers.map((num) => ({
      id: `entry-${num}`,
      sessionId: `session-${num}`,
      displayBasename: `Sheet ${num}`,
      status: CSV_BATCH_STATUS.SAVED,
      rows: [
        {
          importRowId: `row-${num}-1`,
          sheet: `Sheet ${num}`,
          rowNumber: 1,
          saveStatus: 'saved',
          edited: { fullName: `Person ${num}`, phoneNumber: '0241234567', sunday_1: 'P', sunday_2: 'A' },
          raw: { fullName: `Person ${num}` },
          bulkCreate: num >= 5 ? { memberId: `uuid-${num}-1`, sourceSheet: `Sheet ${num}`, sourceRow: 1 } : null,
          match: num < 5 ? { status: 'exact', selectedMemberId: `existing-${num}` } : { status: 'new' },
        },
      ],
    }))

    const initialSummary = getCsvBatchReviewSummary(syntheticBatch)
    expect(initialSummary.completedSheets).toBe(14)
    expect(initialSummary.remainingSheets).toBe(0)

    // Run repair preparation
    const repairedBatch = prepareCsvBatchForReprocess(syntheticBatch, DEFAULT_AFFECTED_REPAIR_SHEETS)

    // Sheets 1-4 must remain saved
    for (let i = 0; i < 4; i += 1) {
      expect(repairedBatch[i].status).toBe(CSV_BATCH_STATUS.SAVED)
      expect(repairedBatch[i].rows[0].saveStatus).toBe('saved')
      expect(repairedBatch[i].needsReprocess).toBeUndefined()
    }

    // Sheets 5..10, 17..20 must be ready for reprocess
    for (let i = 4; i < 14; i += 1) {
      expect(repairedBatch[i].status).toBe(CSV_BATCH_STATUS.READY)
      expect(repairedBatch[i].needsReprocess).toBe(true)
      expect(repairedBatch[i].rows[0].saveStatus).toBe('pending')
      expect(repairedBatch[i].rows[0].needsReprocess).toBe(true)
      // Must preserve previous created member ID
      expect(repairedBatch[i].rows[0].bulkCreate?.memberId).toBe(`uuid-${sheetNumbers[i]}-1`)
    }

    const postSummary = getCsvBatchReviewSummary(repairedBatch)
    expect(postSummary.completedSheets).toBe(4)
    expect(postSummary.remainingSheets).toBe(10)
  })
})
