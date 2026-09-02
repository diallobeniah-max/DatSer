// CSV Import Batch Repair — allows resetting affected sheets that were
// processed before attendance bug fix, preserving created member IDs,
// exact match resolutions, extracted profile fields, and provenance.

import { CSV_BATCH_STATUS } from './csvImportBatch'

export const DEFAULT_AFFECTED_REPAIR_SHEETS = [5, 6, 7, 8, 9, 10, 17, 18, 19, 20]

/**
 * Extract sheet number from a basename or display name like "Sheet 5", "Sheet 05", "5.csv", "sheet_20".
 */
export const extractSheetNumber = (name, fallbackIndex = null) => {
  if (!name && fallbackIndex !== null) return fallbackIndex + 1
  const match = String(name || '').match(/(\d+)/)
  if (match) return parseInt(match[1], 10)
  if (fallbackIndex !== null) return fallbackIndex + 1
  return null
}

/**
 * Check if a batch entry matches the requested repair sheet numbers.
 */
export const isEntryInRepairList = (entry, repairSheetNumbers = DEFAULT_AFFECTED_REPAIR_SHEETS, entryIndex = null) => {
  if (!entry) return false
  const sheetNum = extractSheetNumber(entry.displayBasename || entry.normalizedBasename || entry.originalCsvFilename, entryIndex)
  if (sheetNum !== null && repairSheetNumbers.includes(sheetNum)) return true
  return false
}

/**
 * Prepares batch entries for safe reprocessing.
 * ONLY resets the affected repair sheets; keeps Sheets 1-4 and other sheets untouched.
 * Preserves member IDs, match resolutions, extracted profile data, notes, and provenance.
 */
export const prepareCsvBatchForReprocess = (entries = [], repairSheetNumbers = DEFAULT_AFFECTED_REPAIR_SHEETS) => {
  return entries.map((entry, index) => {
    const isAffected = isEntryInRepairList(entry, repairSheetNumbers, index)
    if (!isAffected) {
      // Untouched sheet: strictly preserved
      return entry
    }

    // Reset affected sheet for retry while preserving all created member identities and extracted data
    const rows = (entry.rows || []).map((row) => {
      const existingMemberId = row.bulkCreate?.memberId || row.createdMemberId || row.memberId || row.match?.selectedMemberId || null
      return {
        ...row,
        saveStatus: 'pending',
        saveError: null,
        needsReprocess: true,
        reprocessReason: 'attendance mapping repair',
        reprocessAttempt: (row.reprocessAttempt || 0) + 1,
        // Preserve previous creation memberId so it is updated rather than recreated
        createdMemberId: existingMemberId || row.createdMemberId || null,
        bulkCreate: row.bulkCreate ? { ...row.bulkCreate } : (existingMemberId ? { memberId: existingMemberId, sourceSheet: row.sheet || entry.displayBasename, sourceRow: row.rowNumber } : null),
      }
    })

    return {
      ...entry,
      rows,
      status: CSV_BATCH_STATUS.READY,
      error: null,
      needsReprocess: true,
      reprocessReason: 'attendance mapping repair',
    }
  })
}
