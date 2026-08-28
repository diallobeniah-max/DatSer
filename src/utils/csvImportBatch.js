import { CSV_IMPORT_MODE } from './csvImportParser'
import { getCsvImportUnresolvedAttentionCount } from './csvImportReview'

export const CSV_BATCH_STATUS = Object.freeze({
  IMAGE_ONLY: 'image_only', CSV_ONLY: 'csv_only', READY: 'ready_for_review',
  DUPLICATE_CSV: 'duplicate_csv', DUPLICATE_IMAGE: 'duplicate_image',
  INVALID: 'invalid', MISMATCH: 'sheet_mismatch', REVIEWED: 'reviewed',
  SAVED: 'saved', FAILED: 'failed', ASSIGNED: 'assigned',
})

export const createCsvBatchId = () => `csv_batch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

export const csvFileBasename = (filename) => String(filename || '')
  .trim().replace(/\.[^.]+$/u, '').trim()

export const normalizeCsvBatchBasename = (filename) => csvFileBasename(filename)
  .replace(/\s+/gu, ' ').toLocaleLowerCase()

export const isCsvBatchFile = (file) => /\.csv$/iu.test(String(file?.name || '').trim())
export const isCsvBatchImage = (file) => /\.(?:jpe?g|png|webp)$/iu.test(String(file?.name || '').trim())

const collator = new globalThis.Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const compareCsvBatchEntries = (left, right) => {
  const a = left.displayBasename || left.basename || ''
  const b = right.displayBasename || right.basename || ''
  const aSheet = /^sheet\s+(\d+)$/iu.exec(a)
  const bSheet = /^sheet\s+(\d+)$/iu.exec(b)
  if (aSheet && bSheet) return Number(aSheet[1]) - Number(bSheet[1])
  if (aSheet) return -1
  if (bSheet) return 1
  return collator.compare(a, b)
}

export const deriveCsvBatchStatus = (entry) => {
  if (entry.status === CSV_BATCH_STATUS.SAVED || entry.status === CSV_BATCH_STATUS.REVIEWED || entry.status === CSV_BATCH_STATUS.ASSIGNED) return entry.status
  if (entry.error || entry.invalid) return CSV_BATCH_STATUS.INVALID
  if ((entry.csvFiles || []).length > 1) return CSV_BATCH_STATUS.DUPLICATE_CSV
  if (entry.sheetMismatch) return CSV_BATCH_STATUS.MISMATCH
  if ((entry.imageFiles || []).length > 1) return CSV_BATCH_STATUS.DUPLICATE_IMAGE
  if (entry.csvFiles?.length && entry.imageFiles?.length) return CSV_BATCH_STATUS.READY
  if (entry.csvFiles?.length) return CSV_BATCH_STATUS.CSV_ONLY
  if (entry.imageFiles?.length) return CSV_BATCH_STATUS.IMAGE_ONLY
  return CSV_BATCH_STATUS.INVALID
}

export const mergeCsvBatchFiles = (existingEntries, { csvFiles = [], imageFiles = [], batchId }) => {
  const byKey = new Map((existingEntries || []).map((entry) => [entry.normalizedBasename, { ...entry, csvFiles: [...(entry.csvFiles || [])], imageFiles: [...(entry.imageFiles || [])] }]))
  const add = (file, kind) => {
    const normalizedBasename = normalizeCsvBatchBasename(file.name)
    const current = byKey.get(normalizedBasename) || {
      id: `${batchId}:${normalizedBasename || Math.random().toString(36).slice(2)}`,
      batchId, normalizedBasename, displayBasename: csvFileBasename(file.name),
      csvFiles: [], imageFiles: [], status: 'draft', createdAt: new Date().toISOString(),
    }
    current[kind].push(file)
    current.status = deriveCsvBatchStatus(current)
    byKey.set(normalizedBasename, current)
  }
  csvFiles.filter(isCsvBatchFile).forEach((file) => add(file, 'csvFiles'))
  imageFiles.filter(isCsvBatchImage).forEach((file) => add(file, 'imageFiles'))
  return [...byKey.values()].map((entry) => ({ ...entry, status: deriveCsvBatchStatus(entry) })).sort(compareCsvBatchEntries)
}

export const getCsvBatchCounts = (entries) => {
  const counts = { csvs: 0, images: 0, paired: 0, missingImage: 0, missingCsv: 0, invalid: 0, ready: 0, reviewed: 0, saved: 0, needsAttention: 0, attentionRows: 0 }
  for (const entry of entries || []) {
    counts.csvs += entry.csvFiles?.length || (entry.originalCsvFilename ? 1 : 0)
    counts.images += entry.imageFiles?.length || entry.persistedImageCount || 0
    const status = deriveCsvBatchStatus(entry)
    if ((entry.csvFiles?.length || entry.originalCsvFilename) && (entry.imageFiles?.length || entry.persistedImageCount)) counts.paired += 1
    if (status === CSV_BATCH_STATUS.CSV_ONLY) counts.missingImage += 1
    if (status === CSV_BATCH_STATUS.IMAGE_ONLY) counts.missingCsv += 1
    if (status === CSV_BATCH_STATUS.INVALID) counts.invalid += 1
    if ([CSV_BATCH_STATUS.READY, CSV_BATCH_STATUS.CSV_ONLY, CSV_BATCH_STATUS.DUPLICATE_IMAGE].includes(status)) counts.ready += 1
    if (status === CSV_BATCH_STATUS.REVIEWED) counts.reviewed += 1
    if (status === CSV_BATCH_STATUS.SAVED) counts.saved += 1
    if ([CSV_BATCH_STATUS.DUPLICATE_CSV, CSV_BATCH_STATUS.DUPLICATE_IMAGE, CSV_BATCH_STATUS.INVALID, CSV_BATCH_STATUS.MISMATCH, CSV_BATCH_STATUS.FAILED].includes(status)) counts.needsAttention += 1
    counts.attentionRows += getCsvImportUnresolvedAttentionCount(entry.rows)
  }
  return counts
}

export const getCsvBatchEntryAttentionCount = (entry) => getCsvImportUnresolvedAttentionCount(entry?.rows)

export const findNextCsvBatchEntry = (entries, currentId, { unsavedOnly = false } = {}) => {
  const ordered = [...(entries || [])].sort(compareCsvBatchEntries)
  const currentIndex = ordered.findIndex((entry) => entry.id === currentId || entry.sessionId === currentId)
  const candidates = [...ordered.slice(currentIndex + 1), ...ordered.slice(0, Math.max(0, currentIndex))]
  return candidates.find((entry) => (
    (entry.csvFiles?.length || entry.originalCsvFilename)
    && (!unsavedOnly || entry.status !== CSV_BATCH_STATUS.SAVED)
  ))
}

export const csvBatchEntryFromSession = (session) => {
  const batch = session?.save_result?.batch
  if (!batch?.id || batch.status === CSV_BATCH_STATUS.ASSIGNED) return null
  return {
    id: session.id, sessionId: session.id, batchId: batch.id, batchName: batch.name,
    normalizedBasename: batch.normalizedBasename,
    displayBasename: batch.displayBasename || session.name,
    originalCsvFilename: batch.originalCsvFilename || null,
    csvFiles: batch.originalCsvFilename ? [{ name: batch.originalCsvFilename, persisted: true }] : [],
    imageFiles: Array.isArray(session.source_images) ? session.source_images : [],
    persistedImageCount: Array.isArray(session.source_images) ? session.source_images.length : 0,
    rows: Array.isArray(session.import_rows) ? session.import_rows : [],
    parsedSheets: Array.isArray(session.parsed_sheets) ? session.parsed_sheets : [],
    mode: batch.mode || session.enabled_sundays?.__mode || CSV_IMPORT_MODE.FULL_REGISTER,
    status: batch.status || (session.save_result?.successCount ? CSV_BATCH_STATUS.SAVED : CSV_BATCH_STATUS.READY),
    error: batch.error || null, sheetMismatch: !!batch.sheetMismatch,
    targetTable: session.target_table || null, enabledSundays: session.enabled_sundays || {},
    createdAt: session.created_at, updatedAt: session.updated_at,
  }
}

export const groupCsvBatchSessions = (sessions) => {
  const groups = new Map()
  for (const session of sessions || []) {
    const entry = csvBatchEntryFromSession(session)
    if (!entry) continue
    const group = groups.get(entry.batchId) || { id: entry.batchId, name: entry.batchName || 'Batch import', entries: [] }
    group.entries.push(entry)
    group.entries.sort(compareCsvBatchEntries)
    groups.set(entry.batchId, group)
  }
  return [...groups.values()]
}
