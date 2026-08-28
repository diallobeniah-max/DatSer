import { assertSupabaseMutationAffected, executeSupabaseWrite } from '../utils/supabaseWrite'

export const CSV_IMPORT_HISTORY_BUCKET = 'csv-import-sources'

const makeSafePathSegment = (value, fallback) => {
  const safe = String(value || fallback)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return safe || fallback
}

const toSaveResult = ({ successCount, failCount, skipCount, unresolvedCount, results, batch }) => ({
  successCount: Number(successCount || 0),
  failCount: Number(failCount || 0),
  skipCount: Number(skipCount || 0),
  unresolvedCount: Number(unresolvedCount || 0),
  results: Array.isArray(results) ? results : [],
  ...(batch ? { batch } : {}),
})

const toSessionPayload = ({ userId, ownerId, csvText, parsedSheets, importRows, targetTable, enabledSundays, saveResults }) => ({
  user_id: userId,
  owner_id: ownerId,
  source_csv: csvText || '',
  parsed_sheets: Array.isArray(parsedSheets) ? parsedSheets : [],
  import_rows: Array.isArray(importRows) ? importRows : [],
  target_table: targetTable || null,
  enabled_sundays: enabledSundays || {},
  save_result: toSaveResult(saveResults || {}),
  updated_at: new Date().toISOString(),
})

const isUploadableImage = (image) => (
  image && typeof image === 'object' && typeof image.name === 'string' && typeof image.size === 'number' && !image.path
)

export const countPersistedCsvImportImages = (session) => (
  (Array.isArray(session?.source_images) ? session.source_images : [])
    .filter((image) => image?.path && (image.bucket || CSV_IMPORT_HISTORY_BUCKET)).length
)

export const uploadSourceImages = async ({ supabase, ownerId, sessionId, sheetImages, onImageStatus }) => {
  const descriptors = []

  for (const [sheet, images] of Object.entries(sheetImages || {})) {
    for (const [index, image] of (images || []).entries()) {
      if (!isUploadableImage(image)) continue

      const extension = makeSafePathSegment(image.name?.split('.').pop(), 'image')
      const objectName = `${String(index + 1).padStart(2, '0')}-${makeSafePathSegment(image.name?.replace(/\.[^.]+$/, ''), 'source')}.${extension}`
      const sheetKey = makeSafePathSegment(sheet, 'sheet')
      const path = `${ownerId}/${sessionId}/${sheetKey}/${objectName}`
      const statusKey = `${sheet}:${index}`
      onImageStatus?.({ key: statusKey, sheet, index, status: 'uploading' })
      const { error } = await supabase.storage.from(CSV_IMPORT_HISTORY_BUCKET).upload(path, image, {
        cacheControl: '3600',
        contentType: image.type || undefined,
        // A history-only retry reuses its stable session path. The matching
        // Storage policies explicitly allow INSERT, SELECT, and UPDATE.
        upsert: true,
      })
      if (error) {
        onImageStatus?.({ key: statusKey, sheet, index, status: 'failed', error: error.message })
        throw error
      }
      const descriptor = {
        id: `${sessionId}:${sheetKey}:${String(index + 1).padStart(2, '0')}`,
        sessionId,
        sheetKey: sheet,
        sheetLabel: sheet,
        sheet: sheet, // legacy readers
        bucket: CSV_IMPORT_HISTORY_BUCKET,
        path,
        name: image.name || objectName,
        contentType: image.type || null,
        size: image.size || null,
        uploadedAt: new Date().toISOString(),
        order: index,
        status: 'saved',
      }
      descriptors.push(descriptor)
      onImageStatus?.({ key: statusKey, sheet, index, status: 'saved', descriptor })
    }
  }

  return descriptors
}

export const persistCsvImportSession = async ({
  supabase, existingSessionId, userId, ownerId, csvText, parsedSheets,
  importRows, targetTable, enabledSundays, saveResults, sheetImages, onImageStatus,
}) => {
  if (!userId || !ownerId) throw new Error('An authenticated workspace is required to save this import.')

  const payload = toSessionPayload({
    userId, ownerId, csvText, parsedSheets, importRows, targetTable, enabledSundays, saveResults,
  })

  let session
  if (existingSessionId) {
    const { data } = await executeSupabaseWrite(
      () => supabase.from('csv_import_sessions').update(payload).eq('id', existingSessionId).select().single(),
      { action: 'Save CSV import history' }
    )
    session = data
  } else {
    const { data } = await executeSupabaseWrite(
      () => supabase.rpc('create_csv_import_session', {
        p_user_id: payload.user_id,
        p_owner_id: payload.owner_id,
        p_source_csv: payload.source_csv,
        p_parsed_sheets: payload.parsed_sheets,
        p_import_rows: payload.import_rows,
        p_target_table: payload.target_table,
        p_enabled_sundays: payload.enabled_sundays,
        p_save_result: payload.save_result,
      }).single(),
      { action: 'Create CSV import history' }
    )
    session = data
  }

  // Re-attempt source images even when the session row already exists. This is
  // what lets a failed Storage upload be retried without replaying any member
  // or attendance operation.
  let newImages
  try {
    newImages = await uploadSourceImages({ supabase, ownerId, sessionId: session.id, sheetImages, onImageStatus })
  } catch (error) {
    // The row itself is durable. Let callers retry only image/history work
    // against this same session rather than creating a second import record.
    error.historySessionId = session.id
    throw error
  }
  const existingImages = Array.isArray(session.source_images) ? session.source_images : []
  const sourceImages = [...existingImages, ...newImages].filter((image, index, all) =>
    all.findIndex((candidate) => candidate.path === image.path) === index
  )
  if (newImages.length > 0) {
    const { data } = await executeSupabaseWrite(
      () => supabase.from('csv_import_sessions').update({ source_images: sourceImages, updated_at: new Date().toISOString() }).eq('id', session.id).select().single(),
      { action: 'Attach CSV import source images' }
    )
    session = data
  }

  return session
}

export const listCsvImportSessions = async ({ supabase }) => {
  const { data } = await executeSupabaseWrite(
    () => supabase
      .from('csv_import_sessions')
      .select('id, name, sequence_number, parsed_sheets, import_rows, target_table, enabled_sundays, save_result, source_images, created_at, updated_at')
      .order('updated_at', { ascending: false }),
    { action: 'Load saved CSV imports' }
  )
  return data || []
}

export const renameCsvImportSession = async ({ supabase, sessionId, name }) => {
  const normalizedName = String(name || '').trim()
  if (!normalizedName) throw new Error('Enter a name for this saved import.')
  if (normalizedName.length > 120) throw new Error('Saved import names can be up to 120 characters.')

  const { data } = await executeSupabaseWrite(
    () => supabase
      .from('csv_import_sessions')
      .update({ name: normalizedName, updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select('id, name, sequence_number, parsed_sheets, import_rows, target_table, enabled_sundays, save_result, source_images, created_at, updated_at')
      .single(),
    { action: 'Rename saved CSV import' }
  )
  return data
}

export const updateCsvImportReviewRows = async ({ supabase, sessionId, importRows }) => {
  const { data } = await executeSupabaseWrite(
    () => supabase
      .from('csv_import_sessions')
      .update({ import_rows: Array.isArray(importRows) ? importRows : [], updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select('id, import_rows, updated_at')
      .single(),
    { action: 'Save CSV review verification' }
  )
  return data
}

export const hydrateSourceImages = async ({ supabase, sourceImages }) => {
  const result = {}
  for (const image of sourceImages || []) {
    const sheet = image?.sheetKey || image?.sheet
    if (!image?.path || !sheet) continue
    const bucket = image.bucket || CSV_IMPORT_HISTORY_BUCKET
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(image.path, 60 * 60)
    if (error || !data?.signedUrl) continue
    if (!result[sheet]) result[sheet] = []
    result[sheet].push({ ...image, sheet, sheetKey: sheet, bucket, previewUrl: data.signedUrl })
  }
  return result
}

export const restoreCsvImportSession = async ({ supabase, sessionId }) => {
  const { data: session } = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').select('*').eq('id', sessionId).single(),
    { action: 'Open saved CSV import' }
  )
  return { session, sheetImages: await hydrateSourceImages({ supabase, sourceImages: session.source_images }) }
}

export const updateCsvImportBatchMetadata = async ({ supabase, sessionId, batch }) => {
  const { data: current } = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').select('save_result').eq('id', sessionId).single(),
    { action: 'Load CSV batch metadata' }
  )
  const { data } = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').update({
      save_result: { ...(current?.save_result || {}), batch }, updated_at: new Date().toISOString(),
    }).eq('id', sessionId).select().single(),
    { action: 'Update CSV batch metadata' }
  )
  return data
}

export const attachCsvImportImageDescriptors = async ({ supabase, sessionId, images }) => {
  const { data: current } = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').select('source_images').eq('id', sessionId).single(),
    { action: 'Load CSV source images' }
  )
  const merged = [...(current?.source_images || []), ...(images || [])].filter((image, index, all) =>
    image?.path && all.findIndex((candidate) => candidate.path === image.path) === index
  )
  const { data } = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').update({ source_images: merged, updated_at: new Date().toISOString() }).eq('id', sessionId).select().single(),
    { action: 'Assign CSV source image' }
  )
  return data
}

export const deleteCsvImportDraft = async ({ supabase, sessionId }) => {
  const { data: current } = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').select('source_images, save_result').eq('id', sessionId).single(),
    { action: 'Load CSV draft before removal' }
  )
  if (current?.save_result?.batch?.status === 'saved' || Number(current?.save_result?.successCount || 0) > 0) {
    throw new Error('Saved imports cannot be removed from the batch workspace.')
  }
  const paths = (current?.source_images || []).map((image) => image?.path).filter(Boolean)
  if (paths.length) {
    const { error } = await supabase.storage.from(CSV_IMPORT_HISTORY_BUCKET).remove(paths)
    if (error) throw error
  }
  await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').delete().eq('id', sessionId),
    { action: 'Remove CSV batch draft' }
  )
}

// A completed import is history, not operational member or attendance data.
// Delete its database row first, so an RLS/FK rejection cannot orphan a still-
// referenced source image. Storage cleanup then removes only this session's
// private objects and is reported as a recoverable warning if it cannot finish.
export const deleteCsvImportSession = async ({ supabase, sessionId }) => {
  if (!sessionId) throw new Error('Choose a saved import to delete.')

  const { data: current } = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').select('source_images').eq('id', sessionId).single(),
    { action: 'Load saved CSV import before deletion' }
  )

  const deletion = await executeSupabaseWrite(
    () => supabase.from('csv_import_sessions').delete().eq('id', sessionId).select('id'),
    { action: 'Delete saved CSV import' }
  )
  assertSupabaseMutationAffected(deletion, 'Delete saved CSV import')

  const pathsByBucket = new Map()
  for (const image of current?.source_images || []) {
    if (!image?.path) continue
    const bucket = image.bucket || CSV_IMPORT_HISTORY_BUCKET
    const paths = pathsByBucket.get(bucket) || []
    if (!paths.includes(image.path)) paths.push(image.path)
    pathsByBucket.set(bucket, paths)
  }

  const cleanupWarnings = []
  for (const [bucket, paths] of pathsByBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths)
    if (error) cleanupWarnings.push(error.message || `Could not remove source images from ${bucket}.`)
  }

  return { storageWarning: cleanupWarnings.join(' ') }
}
