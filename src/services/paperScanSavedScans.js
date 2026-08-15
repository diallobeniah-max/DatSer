// Phase 4C client bridge for private Saved Scans.
//
// A completed extraction is persisted so reopening a scan never re-bills
// Gemini. Every sheet image goes to a PRIVATE bucket and the metadata row to
// an RLS-protected table through the authenticated browser session — no
// service-role secret is ever shipped to the browser, no public URL exists,
// and reopening uses signed URLs.
//
// Idempotency contract: `id` is the client review session id. Saving the same
// session again is an UPSERT on that id, and the sheet image is re-uploaded
// with upsert=true to the SAME object path, so repeated Save always updates
// the same scan. Delete removes only the scan row and its owned storage
// objects.

export const SAVED_SCANS_BUCKET = 'paper-scan-saved'
export const SAVED_SCANS_TABLE = 'paper_scan_saved'
export const SAVED_SCAN_MAX_IMAGE_BYTES = 4 * 1024 * 1024

export const createSavedScanId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const createScanName = (sheetCount = 1) => {
  const dateLabel = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const countLabel = sheetCount > 1 ? ` (${sheetCount} sheets)` : ''
  return `Attendance sheet · ${dateLabel}${countLabel}`
}

export const buildSheetImagePath = ({ userId, scanId, sheetId }) => `${userId}/${scanId}/${sheetId}.jpg`

const hasOkResult = (resultsBySheet, sheetId) => {
  const result = resultsBySheet?.[sheetId]
  return result?.status === 'ok' && Boolean(result?.payload)
}

// Faithful Gemini snapshot per sheet: sheet metadata, the untouched AI rows
// (which carry `originalGeminiValue` plus any `reviewedValues` decisions and
// `attendance`), sheet warnings, and the excluded-row indices.
export const buildExtractionSnapshot = (resultsBySheet) => {
  const snapshot = {}
  for (const [sheetId, result] of Object.entries(resultsBySheet || {})) {
    if (result?.status !== 'ok' || !result?.payload) continue
    snapshot[sheetId] = {
      source: result.source || '',
      excludedIndices: Array.isArray(result.excludedIndices) ? result.excludedIndices : [],
      sheet: result.payload.sheet || { detected_headers: [], attendance_dates: [] },
      rows: Array.isArray(result.payload.rows) ? result.payload.rows : [],
      warnings: Array.isArray(result.payload.warnings) ? result.payload.warnings : [],
      extractedAt: result.payload.extractedAt || null
    }
  }
  return snapshot
}

// Compact review/correction state per sheet: which rows are excluded and how
// many field decisions (matching choices: scan / datser / edited) were made.
// The decisions themselves live per-row inside extraction so the choice and its
// original value always stay together.
export const buildReviewState = (sheets, resultsBySheet) => {
  const state = {}
  const sheetList = Array.isArray(sheets) ? sheets : []
  for (const sheet of sheetList) {
    const result = resultsBySheet?.[sheet.id]
    if (result?.status !== 'ok' || !result?.payload) continue
    const rows = Array.isArray(result.payload.rows) ? result.payload.rows : []
    state[sheet.id] = {
      excludedIndices: Array.isArray(result.excludedIndices) ? result.excludedIndices : [],
      rowCount: rows.length,
      decisionCount: rows.reduce((sum, row) => sum + Object.keys(row?.reviewedValues || {}).length, 0)
    }
  }
  return state
}

// Attendance extraction snapshot: per sheet the attendance dates found on the
// sheet and each row's attendance marks (with confidence and exclusion state).
export const buildAttendanceExtraction = (resultsBySheet) => {
  const snapshot = {}
  for (const [sheetId, result] of Object.entries(resultsBySheet || {})) {
    if (result?.status !== 'ok' || !result?.payload) continue
    const payload = result.payload
    const excludedIndices = Array.isArray(result.excludedIndices) ? result.excludedIndices : []
    snapshot[sheetId] = {
      attendance_dates: payload.sheet?.attendance_dates || [],
      marks: (Array.isArray(payload.rows) ? payload.rows : []).map((row, index) => ({
        index,
        full_name: row?.full_name || '',
        attendance: row?.attendance || {},
        confidence: row?.confidence ?? null,
        excluded: excludedIndices.includes(index)
      }))
    }
  }
  return snapshot
}

// Gemini token counts per sheet, with a `_total` roll-up for a quick glance.
export const buildUsageMetadataSnapshot = (resultsBySheet) => {
  const snapshot = {}
  let promptTokens = 0
  let candidatesTokens = 0
  for (const [sheetId, result] of Object.entries(resultsBySheet || {})) {
    if (result?.status !== 'ok' || !result?.payload) continue
    const usage = result.payload.usageMetadata
    if (!usage || typeof usage !== 'object') continue
    snapshot[sheetId] = usage
    promptTokens += Number(usage.promptTokenCount) || 0
    candidatesTokens += Number(usage.candidatesTokenCount) || 0
  }
  if (Object.keys(snapshot).length) {
    snapshot._total = { promptTokenCount: promptTokens, candidatesTokenCount: candidatesTokens }
  }
  return snapshot
}

export const dataUrlToBlob = (dataUrl, mimeType) => {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl || '')
  if (!match) return null
  try {
    const binary = globalThis.atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], { type: mimeType || match[1] })
  } catch {
    return null
  }
}

// Uploads one sheet's processed image to its stable object path. upsert=true
// makes repeated Save of the same session replace the previous image instead
// of stacking duplicates. Accepts either a raw data URL or a pre-normalized
// blob (the caller is responsible for normalizing to image/jpeg / .jpg).
export const uploadSheetImage = async ({ supabase, userId, scanId, sheetId, dataUrl, blob: providedBlob }) => {
  const blob = providedBlob || dataUrlToBlob(dataUrl)
  if (!blob) {
    throw new Error('The sheet image could not be encoded for saving.')
  }
  const path = buildSheetImagePath({ userId, scanId, sheetId })
  const { error } = await supabase.storage.from(SAVED_SCANS_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: true
  })
  if (error) {
    const status = error.statusCode || error.status || ''
    const serverMessage = error.message || error.error || 'The sheet image could not be saved.'
    const sizeNote = blob.size > SAVED_SCAN_MAX_IMAGE_BYTES
      ? ` The image is ${(blob.size / (1024 * 1024)).toFixed(1)} MiB; Saved Scans accepts files up to 4 MiB.`
      : ''
    throw new Error(`Saved Scan storage upload${status ? ` failed (${status})` : ' failed'}: ${serverMessage}.${sizeNote}`)
  }
  return path
}

const upsertSavedScanRecord = async ({ supabase, record }) => {
  const { data, error } = await supabase
    .from(SAVED_SCANS_TABLE)
    .upsert(record, { onConflict: 'id' })
    .select('id,name,user_id,owner_id,sheet_images,review_state,save_result,updated_at,created_at')
    .single()
  if (error) {
    throw new Error(error.message || 'The scan could not be saved.')
  }
  return data || record
}

// Builds the full row payload (no I/O). Keep pure for deterministic tests.
// `extraMeta` (e.g. the final-save result) is merged verbatim into the record.
export const buildSavedScanRecord = ({ scanId, userId, ownerId, name, sheets, resultsBySheet, extraMeta = null }) => {
  const sheetList = Array.isArray(sheets) ? sheets : []
  const sheetImages = sheetList
    .filter((sheet) => hasOkResult(resultsBySheet, sheet.id))
    .map((sheet) => ({
      sheetId: sheet.id,
      source: sheet.source || '',
      path: buildSheetImagePath({ userId, scanId, sheetId: sheet.id })
    }))
  const record = {
    id: scanId,
    user_id: userId,
    owner_id: ownerId,
    name,
    sheet_images: sheetImages,
    extraction: buildExtractionSnapshot(resultsBySheet),
    review_state: buildReviewState(sheetList, resultsBySheet),
    attendance: buildAttendanceExtraction(resultsBySheet),
    usage_metadata: buildUsageMetadataSnapshot(resultsBySheet)
  }
  if (extraMeta && typeof extraMeta === 'object') {
    record.save_result = extraMeta
  }
  return record
}

// Uploads every sheet image, then idempotently upserts the scan row. The
// record is created inside this single call so rows only ever reference
// storage objects that were successfully written first.
export const savePaperScan = async ({
  supabase,
  scanId,
  userId,
  ownerId,
  name,
  sheets,
  resultsBySheet,
  uploadImage = uploadSheetImage,
  storedSheetImages = [],
  extraMeta = null
}) => {
  const sheetImages = []
  const sheetList = Array.isArray(sheets) ? sheets : []
  for (const sheet of sheetList) {
    if (!hasOkResult(resultsBySheet, sheet.id)) continue
    const stored = (Array.isArray(storedSheetImages) ? storedSheetImages : []).find((entry) => entry.sheetId === sheet.id)
    const path = stored?.path
      || await uploadImage({ supabase, userId, scanId, sheetId: sheet.id, dataUrl: sheet.preview || sheet.dataUrl })
    sheetImages.push({ sheetId: sheet.id, source: sheet.source || '', path })
  }

  const record = buildSavedScanRecord({ scanId, userId, ownerId, name, sheets: sheetList, resultsBySheet, extraMeta })
  record.sheet_images = sheetImages

  return { scan: await upsertSavedScanRecord({ supabase, record }) }
}

// Lightweight, durable staging record written only after a sheet object exists.
// It intentionally contains no Gemini result, member, or attendance mutation.
// Repeating it for the same session id replaces the same row and stable paths.
export const saveStagedPaperScan = async ({ supabase, scanId, userId, ownerId, name, sheetImages }) => {
  const record = buildSavedScanRecord({
    scanId,
    userId,
    ownerId,
    name,
    sheets: [],
    resultsBySheet: {}
  })
  record.sheet_images = (Array.isArray(sheetImages) ? sheetImages : [])
    .filter((image) => image?.sheetId && image?.path)
    .map((image) => ({
      sheetId: image.sheetId,
      source: image.source || '',
      path: image.path
    }))
  record.review_state = { _staging: true }
  return { scan: await upsertSavedScanRecord({ supabase, record }) }
}

// Atomic merge of ONE sheet into the durable staging metadata. The RPC locks
// the Saved Scan row, reads the LATEST sheet_images, merges exactly this
// sheet, and returns the durable row — so concurrent staging saves can never
// overwrite each other's references, regardless of completion order.
export const mergeStagedSheet = async ({ supabase, scanId, ownerId, name, sheet }) => {
  if (!supabase || !scanId || !ownerId) {
    throw new Error('Saved Scan metadata merge is missing its durable context.')
  }
  const { data, error } = await supabase.rpc('paper_scan_merge_staged_sheet', {
    p_scan_id: scanId,
    p_owner_id: ownerId,
    p_name: name || null,
    p_sheet: {
      sheetId: sheet?.sheetId,
      source: sheet?.source || '',
      path: sheet?.path
    }
  })
  if (error) {
    throw new Error(error.message || 'The staged sheet could not be saved.')
  }
  return data
}

// Removes ONE sheet reference from the durable staging metadata. This is
// metadata-only and never deletes the remote storage object.
export const removeStagedSheet = async ({ supabase, scanId, ownerId, sheetId }) => {
  if (!supabase || !scanId || !ownerId || !sheetId) {
    throw new Error('Saved Scan metadata removal is missing its durable context.')
  }
  const { data, error } = await supabase.rpc('paper_scan_remove_staged_sheet', {
    p_scan_id: scanId,
    p_owner_id: ownerId,
    p_sheet_id: sheetId
  })
  if (error) {
    throw new Error(error.message || 'The staged sheet could not be removed.')
  }
  return data
}

// The set of sheet ids durably present in a saved scan's latest metadata.
// Used to prove a sheet really is Saved before any AI processing.
export const durableSheetIdsFromScan = (record) => {
  const images = Array.isArray(record?.sheet_images) ? record.sheet_images : []
  return new Set(images.map((image) => image?.sheetId).filter(Boolean))
}

// True when the record is a staging batch (review_state._staging), i.e. a
// batch prepared for AI processing but never extracted into a full Saved Scan.
export const isStagingRecord = (record) => record?.review_state?._staging === true

export const listSavedScans = async ({ supabase, ownerId }) => {
  let query = supabase
    .from(SAVED_SCANS_TABLE)
    .select('id,name,user_id,owner_id,sheet_images,usage_metadata,review_state,created_at,updated_at')
    .order('updated_at', { ascending: false })
  if (ownerId) query = query.eq('owner_id', ownerId)
  const { data, error } = await query
  if (error) {
    throw new Error(error.message || 'Saved scans could not be loaded.')
  }
  return Array.isArray(data) ? data : []
}

export const getSavedScan = async ({ supabase, id }) => {
  const { data, error } = await supabase
    .from(SAVED_SCANS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw new Error(error.message || 'The saved scan could not be loaded.')
  }
  return data || null
}

// Signed, short-lived, RLS-gated URL for reopening a stored sheet image. No
// public URL is ever generated for these files.
export const createSheetImageSignedUrl = async ({ supabase, path }) => {
  const { data, error } = await supabase.storage.from(SAVED_SCANS_BUCKET).createSignedUrl(path, 3600)
  if (error) {
    throw new Error(error.message || 'The sheet image could not be opened.')
  }
  return data?.signedUrl || ''
}

export const renameSavedScan = async ({ supabase, id, name }) => {
  const trimmed = String(name || '').trim()
  if (!trimmed) {
    throw new Error('A scan name is required.')
  }
  const { data, error } = await supabase
    .from(SAVED_SCANS_TABLE)
    .update({ name: trimmed })
    .eq('id', id)
    .select('id,name')
    .single()
  if (error) {
    throw new Error(error.message || 'The scan name could not be updated.')
  }
  return data
}

// Removes every object under {user_id}/{scan_id}. Only the scan's own objects
// (plus any orphaned sheet images from earlier saves of the same session).
export const deleteStorageFolder = async ({ supabase, userId, scanId }) => {
  const prefix = `${userId}/${scanId}`
  const { data, error } = await supabase.storage.from(SAVED_SCANS_BUCKET).list(prefix, { limit: 100, offset: 0 })
  if (error) {
    throw new Error(error.message || 'The sheet files could not be listed.')
  }
  const names = (Array.isArray(data) ? data : []).map((entry) => entry?.name).filter(Boolean)
  if (names.length) {
    const { error: removeError } = await supabase.storage
      .from(SAVED_SCANS_BUCKET)
      .remove(names.map((name) => `${prefix}/${name}`))
    if (removeError) {
      throw new Error(removeError.message || 'The sheet files could not be deleted.')
    }
  }
}

// Deletes ONLY this scan's storage objects and its row. Members, attendance,
// the quota/security ledger, and unrelated scans are untouched.
export const deleteSavedScan = async ({ supabase, scan }) => {
  await deleteStorageFolder({ supabase, userId: scan.user_id, scanId: scan.id })
  const { error } = await supabase.from(SAVED_SCANS_TABLE).delete().eq('id', scan.id)
  if (error) {
    throw new Error(error.message || 'The scan could not be deleted.')
  }
  return true
}

// Reopening helpers: reconstruct the Compare & Correct state from one saved row.
export const rowsFromSavedScan = (record, sheetId) => {
  const result = record?.extraction?.[sheetId]
  return Array.isArray(result?.rows) ? result.rows : []
}

export const excludedIndicesFromSavedScan = (record, sheetId) => {
  const reviewState = record?.review_state?.[sheetId]?.excludedIndices
  const extractionIndices = record?.extraction?.[sheetId]?.excludedIndices
  const combined = [...(Array.isArray(reviewState) ? reviewState : []), ...(Array.isArray(extractionIndices) ? extractionIndices : [])]
  return Array.from(new Set(combined)).sort((a, b) => a - b)
}

export const usageMetadataFromSavedScan = (record, sheetId) => record?.usage_metadata?.[sheetId] || null

// The persisted final-save result, restored on reopen so the saved scan shows
// the same summary without re-running Gemini or re-writing anything.
// Legacy rows used `{}` as the old database default. It means no final-save
// operation exists, not a completed save result.
export const saveResultFromSavedScan = (record) => {
  const result = record?.save_result
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length === 0) return null
  return result
}

// Client-readable storage readout. Supabase lists folders as entries without
// an `id` and without a size; only real objects carry a byte size, and the
// browser session can only see buckets/objects its RLS policies allow.
const isFolderEntry = (entry) => Boolean(entry?.id === null || !entry?.metadata || !Number.isFinite(Number(entry?.metadata?.size)))

const walkBucketSizes = async ({ supabase, bucket, prefix, result }) => {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset: 0 })
  if (error) throw new Error(error.message || 'Storage could not be listed.')
  for (const entry of Array.isArray(data) ? data : []) {
    if (!entry?.name) continue
    if (isFolderEntry(entry)) {
      await walkBucketSizes({ supabase, bucket, prefix: prefix ? `${prefix}/${entry.name}` : entry.name, result })
      continue
    }
    result.bytes += Number(entry.metadata?.size) || 0
    result.objects += 1
    result.paths.push(prefix ? `${prefix}/${entry.name}` : entry.name)
  }
}

// Bytes of THIS user's saved scan images inside the private saved-scans
// bucket (everything under `{userId}/`), used for the Saved Scan card.
export const getSavedScanStorageUsage = async ({ supabase, userId }) => {
  const result = { bytes: 0, objects: 0, paths: [] }
  if (!userId) return result
  await walkBucketSizes({ supabase, bucket: SAVED_SCANS_BUCKET, prefix: String(userId), result })
  return result
}

// The full project-wide object total is NOT exposed to the client (storage
// RLS is per-bucket), so this only sums what the session can actually read.
export const probeReadableFileStorage = async ({ supabase, userId }) => {
  const buckets = [
    { bucket: SAVED_SCANS_BUCKET, prefix: String(userId || '') },
    { bucket: 'app-updates', prefix: '' },
    { bucket: 'member-code-branding', prefix: String(userId || '') }
  ]
  const result = { bytes: 0, objects: 0, buckets: [] }
  for (const { bucket, prefix } of buckets) {
    const walk = { bytes: 0, objects: 0, paths: [] }
    try {
      await walkBucketSizes({ supabase, bucket, prefix, result: walk })
      result.bytes += walk.bytes
      result.objects += walk.objects
      result.buckets.push({ bucket, bytes: walk.bytes, objects: walk.objects })
    } catch {
      // Private/cross-user buckets are expected to be unreadable; skip.
    }
  }
  return result
}
