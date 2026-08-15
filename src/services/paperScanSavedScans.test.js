// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  SAVED_SCANS_BUCKET,
  SAVED_SCANS_TABLE,
  buildAttendanceExtraction,
  buildExtractionSnapshot,
  buildReviewState,
  buildSavedScanRecord,
  buildSheetImagePath,
  buildUsageMetadataSnapshot,
  createScanName,
  createSheetImageSignedUrl,
  dataUrlToBlob,
  deleteSavedScan,
  durableSheetIdsFromScan,
  excludedIndicesFromSavedScan,
  getSavedScan,
  isStagingRecord,
  listSavedScans,
  mergeStagedSheet,
  removeStagedSheet,
  renameSavedScan,
  rowsFromSavedScan,
  savePaperScan,
  saveStagedPaperScan,
  uploadSheetImage,
  usageMetadataFromSavedScan
} from './paperScanSavedScans'

// Tiny supabase-like builder returning a chain of stubs.
const mockSupabase = () => {
  const calls = { from: [], storageUploads: [], storageLists: [], storageRemoves: [], storageSigned: [] }

  const handoff = (value, extra = {}) => ({
    eq: () => handoff(value, extra),
    order: () => handoff(value, extra),
    single: () => Promise.resolve(value),
    maybeSingle: () => Promise.resolve(value),
    select: () => handoff(value, extra),
    then: (resolve) => Promise.resolve(resolve(value))
  })

  const from = vi.fn().mockImplementation((table) => {
    calls.from.push(table)
    return {
      upsert: vi.fn().mockImplementation((record, options) => {
        calls.upsertLast = { record, options }
        return { select: () => handoff({ data: { id: record.id, name: record.name } }) }
      }),
      delete: vi.fn(() => handoff({ data: null, error: null })),
      update: vi.fn(() => handoff({ data: { id: 'scan-1', name: 'Renamed' } })),
      select: vi.fn(() => handoff({ data: [{ id: 'scan-1', name: 'A' }] }))
    }
  })

  const rpc = vi.fn().mockImplementation((name, params) => {
    calls.rpcLast = { name, params }
    return Promise.resolve({ data: { id: 'scan-1', sheet_images: [], review_state: { _staging: true } }, error: null })
  })

  const bucket = vi.fn().mockImplementation((name) => {
    calls.bucketName = name
    return {
      upload: vi.fn().mockImplementation((path, blob, options) => {
        calls.storageUploads.push({ name, path, blob, options })
        return Promise.resolve({ data: { path }, error: null })
      }),
      remove: vi.fn().mockImplementation((paths) => {
        calls.storageRemoves.push({ name, paths })
        return Promise.resolve({ data: paths, error: null })
      }),
      list: vi.fn().mockImplementation((path, options) => {
        calls.storageLists.push({ name, path, options })
        return Promise.resolve({ data: [{ name: 'img.jpg' }], error: null })
      }),
      createSignedUrl: vi.fn().mockImplementation((path, expiresIn) => {
        calls.storageSigned.push({ name, path, expiresIn })
        return Promise.resolve({ data: { signedUrl: `signed:${path}` }, error: null })
      })
    }
  })

  return {
    calls,
    from,
    rpc,
    storage: { from: bucket },
    __errors: { from, bucket }
  }
}

const okSheet = {
  id: 'sheet-1',
  source: 'Camera capture',
  dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
  preview: 'data:image/jpeg;base64,cHJldmlldw=='
}

const okResult = {
  status: 'ok',
  sheetId: 'sheet-1',
  source: 'Camera capture',
  error: '',
  excludedIndices: [2],
  payload: {
    sheet: { detected_headers: ['Name'], attendance_dates: ['2026-07-05'] },
    rows: [
      {
        full_name: 'Ama Serwaa',
        phone_number: '0241111111',
        gender: 'Female',
        current_level: 'SHS1',
        confidence: 0.9,
        attendance: { '2026-07-05': 'Present' },
        warnings: [],
        originalGeminiValue: { full_name: 'Ama Serwaa', phone_number: '0249999999', gender: 'Female', current_level: 'SHS1' },
        reviewedValues: { phone_number: { value: '0241111111', source: 'datser' } }
      }
    ],
    warnings: [],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 }
  }
}

describe('record builders', () => {
  it('builds a deterministic image path scoped to the user folder', () => {
    expect(buildSheetImagePath({ userId: 'u1', scanId: 'scan-1', sheetId: 'sheet-1' })).toBe('u1/scan-1/sheet-1.jpg')
  })

  it('names scans from today with a sheet count', () => {
    const name = createScanName(2)
    expect(name).toMatch(/Attendance sheet · .* \(2 sheets\)/)
    expect(createScanName(1)).not.toContain('(1 sheets)')
  })

  it('keeps the untouched Gemini values and the review decisions together', () => {
    const snapshot = buildExtractionSnapshot({ 'sheet-1': okResult })
    const row = snapshot['sheet-1'].rows[0]
    expect(row.originalGeminiValue.phone_number).toBe('0249999999')
    expect(row.reviewedValues.phone_number).toEqual({ value: '0241111111', source: 'datser' })
    expect(row.attendance['2026-07-05']).toBe('Present')
    expect(snapshot['sheet-1'].excludedIndices).toEqual([2])
  })

  it('skips failed or missing sheets in every snapshot builder', () => {
    const resultsBySheet = { 'sheet-1': okResult, 'sheet-failed': { status: 'failed' } }
    expect(Object.keys(buildExtractionSnapshot(resultsBySheet))).toEqual(['sheet-1'])
    expect(Object.keys(buildAttendanceExtraction(resultsBySheet))).toEqual(['sheet-1'])
    expect(Object.keys(buildUsageMetadataSnapshot(resultsBySheet))).toEqual(['sheet-1', '_total'])
  })

  it('builds the attendance extraction snapshot per sheet', () => {
    const snapshot = buildAttendanceExtraction({ 'sheet-1': okResult })
    expect(snapshot['sheet-1'].attendance_dates).toEqual(['2026-07-05'])
    expect(snapshot['sheet-1'].marks[0]).toEqual({
      index: 0,
      full_name: 'Ama Serwaa',
      attendance: { '2026-07-05': 'Present' },
      confidence: 0.9,
      excluded: false
    })
  })

  it('builds review state with excluded rows and decision counts', () => {
    const state = buildReviewState([okSheet], { 'sheet-1': okResult })
    expect(state['sheet-1'].excludedIndices).toEqual([2])
    expect(state['sheet-1'].decisionCount).toBe(1)
    expect(state['sheet-1'].rowCount).toBe(1)
  })

  it('rolls up usage metadata per sheet and a total', () => {
    const snapshot = buildUsageMetadataSnapshot({ 'sheet-1': okResult })
    expect(snapshot['sheet-1'].promptTokenCount).toBe(12)
    expect(snapshot._total).toEqual({ promptTokenCount: 12, candidatesTokenCount: 34 })
  })

  it('decodes a data URL into a blob', () => {
    const blob = dataUrlToBlob('data:image/jpeg;base64,aGVsbG8=', 'image/jpeg')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/jpeg')
    expect(blob.size).toBe(5)
    expect(dataUrlToBlob('not a data url')).toBeNull()
  })

  it('builds the completed scan record with every persisted concept', () => {
    const record = buildSavedScanRecord({
      scanId: 'scan-1',
      userId: 'u1',
      ownerId: 'owner-1',
      name: 'My scan',
      sheets: [okSheet],
      resultsBySheet: { 'sheet-1': okResult }
    })
    expect(record.id).toBe('scan-1')
    expect(record.user_id).toBe('u1')
    expect(record.owner_id).toBe('owner-1')
    expect(record.sheet_images[0].path).toBe('u1/scan-1/sheet-1.jpg')
    expect(record.extraction['sheet-1'].rows[0].originalGeminiValue.phone_number).toBe('0249999999')
    expect(record.usage_metadata['sheet-1'].candidatesTokenCount).toBe(34)
  })
})

describe('savePaperScan (idempotent save)', () => {
  it('persists a staging record only after object paths are known', async () => {
    const sb = mockSupabase()
    await saveStagedPaperScan({
      supabase: sb,
      scanId: 'scan-1',
      userId: 'u1',
      ownerId: 'owner-1',
      name: 'Staged scan',
      sheetImages: [{ sheetId: 'sheet-1', source: 'Camera capture', path: 'u1/scan-1/sheet-1.jpg' }]
    })
    expect(sb.calls.storageUploads).toHaveLength(0)
    expect(sb.calls.upsertLast.record.sheet_images).toEqual([
      { sheetId: 'sheet-1', source: 'Camera capture', path: 'u1/scan-1/sheet-1.jpg' }
    ])
    expect(sb.calls.upsertLast.record.review_state).toEqual({ _staging: true })
  })

  it('uploads each successful sheet image then upserts the scan on its session id', async () => {
    const sb = mockSupabase()
    const result = await savePaperScan({
      supabase: sb,
      scanId: 'scan-1',
      userId: 'u1',
      ownerId: 'owner-1',
      name: 'My scan',
      sheets: [okSheet, { id: 'sheet-2', source: 'x', dataUrl: 'data:image/jpeg;base64,eA==' }],
      resultsBySheet: { 'sheet-1': okResult, 'sheet-2': { status: 'failed', error: 'nope' } },
      uploadImage: async ({ supabase, userId, scanId, sheetId, dataUrl }) => {
        sb.calls.storageUploads.push({ userId, scanId, sheetId, dataUrl })
        return `${userId}/${scanId}/${sheetId}.jpg`
      }
    })
    // Only the ok sheet uploaded.
    expect(sb.calls.storageUploads).toHaveLength(1)
    expect(sb.calls.storageUploads[0]).toEqual({
      userId: 'u1',
      scanId: 'scan-1',
      sheetId: 'sheet-1',
      dataUrl: okSheet.preview
    })
    // One upsert keyed by the session id, with the committed sheet_images list.
    const upsert = sb.calls.upsertLast
    expect(upsert.options).toEqual({ onConflict: 'id' })
    expect(upsert.record.id).toBe('scan-1')
    expect(upsert.record.sheet_images[0]).toEqual({ sheetId: 'sheet-1', source: 'Camera capture', path: 'u1/scan-1/sheet-1.jpg' })
    expect(upsert.record.review_state['sheet-1'].decisionCount).toBe(1)
    expect(upsert.record.usage_metadata['sheet-1'].promptTokenCount).toBe(12)
    expect(upsert.record.attendance['sheet-1'].marks[0].attendance['2026-07-05']).toBe('Present')
    expect(result.scan.id).toBe('scan-1')
  })

  it('repeated Save of the same session updates the same id (idempotent)', async () => {
    const sb = mockSupabase()
    let uploadCount = 0
    const shared = {
      scanId: 'scan-1',
      userId: 'u1',
      ownerId: 'owner-1',
      name: 'My scan',
      sheets: [okSheet],
      resultsBySheet: { 'sheet-1': okResult },
      uploadImage: async ({ supabase, userId, scanId, sheetId }) => {
        uploadCount += 1
        return `${userId}/${scanId}/${sheetId}.jpg`
      }
    }
    await savePaperScan({ supabase: sb, ...shared })
    await savePaperScan({ supabase: sb, ...shared })
    expect(uploadCount).toBe(2)
    expect(sb.calls.upsertLast.record.id).toBe('scan-1')
  })

  it('real uploadSheetImage uses the private bucket with upsert and a content type', async () => {
    const sb = mockSupabase()
    const path = await uploadSheetImage({ supabase: sb, userId: 'u1', scanId: 'scan-1', sheetId: 'sheet-1', dataUrl: 'data:image/jpeg;base64,aGVsbG8=' })
    expect(path).toBe('u1/scan-1/sheet-1.jpg')
    const upload = sb.calls.storageUploads[0]
    expect(upload.name).toBe(SAVED_SCANS_BUCKET)
    expect(upload.options.upsert).toBe(true)
    expect(upload.blob.type).toBe('image/jpeg')
  })

  it('throws a friendly error when the sheet image cannot be encoded', async () => {
    const sb = mockSupabase()
    await expect(uploadSheetImage({ supabase: sb, userId: 'u1', scanId: 'scan-1', sheetId: 'sheet-1', dataUrl: 'nope' }))
      .rejects.toThrow('The sheet image could not be encoded for saving.')
  })

  it('preserves a Storage response status and message for actionable retries', async () => {
    const sb = mockSupabase()
    sb.storage.from.mockImplementation(() => ({
      upload: async () => ({ error: { statusCode: 400, message: 'The object exceeded the maximum allowed size' } })
    }))
    await expect(uploadSheetImage({ supabase: sb, userId: 'u1', scanId: 'scan-1', sheetId: 'sheet-1', dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }))
      .rejects.toThrow('Saved Scan storage upload failed (400): The object exceeded the maximum allowed size.')
  })
})

describe('atomic staging metadata (merge / remove RPC bridge)', () => {
  it('mergeStagedSheet calls the atomic RPC with the owner and one sheet', async () => {
    const sb = mockSupabase()
    const durable = await mergeStagedSheet({
      supabase: sb,
      scanId: 'scan-1',
      ownerId: 'owner-1',
      name: 'Staged scan',
      sheet: { sheetId: 'sheet-1', source: 'Camera capture', path: 'u1/scan-1/sheet-1.jpg' }
    })
    expect(sb.calls.rpcLast.name).toBe('paper_scan_merge_staged_sheet')
    expect(sb.calls.rpcLast.params).toEqual({
      p_scan_id: 'scan-1',
      p_owner_id: 'owner-1',
      p_name: 'Staged scan',
      p_sheet: { sheetId: 'sheet-1', source: 'Camera capture', path: 'u1/scan-1/sheet-1.jpg' }
    })
    expect(durable.id).toBe('scan-1')
    // The merge path must not go through a full-row upsert.
    expect(sb.calls.upsertLast).toBeUndefined()
  })

  it('mergeStagedSheet surfaces an RPC error as a friendly message', async () => {
    const sb = mockSupabase()
    sb.rpc.mockResolvedValue({ data: null, error: new Error('anonymous') })
    await expect(mergeStagedSheet({
      supabase: sb,
      scanId: 'scan-1',
      ownerId: 'owner-1',
      sheet: { sheetId: 'sheet-1', path: 'u1/scan-1/sheet-1.jpg' }
    })).rejects.toThrow('anonymous')
  })

  it('removeStagedSheet calls the metadata-only RPC and never touches storage', async () => {
    const sb = mockSupabase()
    const durable = await removeStagedSheet({ supabase: sb, scanId: 'scan-1', ownerId: 'owner-1', sheetId: 'sheet-1' })
    expect(sb.calls.rpcLast.name).toBe('paper_scan_remove_staged_sheet')
    expect(sb.calls.rpcLast.params).toEqual({ p_scan_id: 'scan-1', p_owner_id: 'owner-1', p_sheet_id: 'sheet-1' })
    expect(durable.id).toBe('scan-1')
    expect(sb.calls.storageLists).toHaveLength(0)
    expect(sb.calls.storageRemoves).toHaveLength(0)
    expect(sb.calls.storageUploads).toHaveLength(0)
  })

  it('durableSheetIdsFromScan reads the latest durable sheet ids only', () => {
    const ids = durableSheetIdsFromScan({
      sheet_images: [
        { sheetId: 'sheet-1', path: 'u1/scan-1/sheet-1.jpg' },
        { sheetId: 'sheet-2', path: 'u1/scan-1/sheet-2.jpg' }
      ]
    })
    expect(ids.has('sheet-1')).toBe(true)
    expect(ids.has('sheet-2')).toBe(true)
    expect(ids.has('sheet-3')).toBe(false)
    expect(durableSheetIdsFromScan(null).size).toBe(0)
    expect(durableSheetIdsFromScan({ sheet_images: [] }).size).toBe(0)
  })

  it('isStagingRecord detects a staging batch and rejects an extracted scan', () => {
    expect(isStagingRecord({ review_state: { _staging: true } })).toBe(true)
    expect(isStagingRecord({ review_state: { _staging: true, 'sheet-1': {} } })).toBe(true)
    expect(isStagingRecord({ review_state: { 'sheet-1': {} } })).toBe(false)
    expect(isStagingRecord({ review_state: {} })).toBe(false)
    expect(isStagingRecord(null)).toBe(false)
  })
})

describe('list / get / rename / signed urls', () => {
  it('lists saved scans scoped to the active workspace owner', async () => {
    const sb = mockSupabase()
    const listed = await listSavedScans({ supabase: sb, ownerId: 'owner-1' })
    expect(listed).toHaveLength(1)
    expect(sb.calls.from[0]).toBe(SAVED_SCANS_TABLE)
    expect(sb.calls.from[0]).not.toBe('members')
    expect(sb.calls.from[0]).not.toMatch(/attendance/)
  })

  it('loads a stored scan with all columns including usage metadata', async () => {
    const sb = mockSupabase()
    const scan = await getSavedScan({ supabase: sb, id: 'scan-1' })
    expect(scan).toBeTruthy()
    expect(sb.calls.from[0]).toBe(SAVED_SCANS_TABLE)
  })

  it('renames with the trimmed name', async () => {
    const sb = mockSupabase()
    const renamed = await renameSavedScan({ supabase: sb, id: 'scan-1', name: '  Renamed  ' })
    expect(renamed.name).toBe('Renamed')
    expect(sb.calls.upsertLast).toBeUndefined()
  })

  it('rejects an empty rename', async () => {
    await expect(renameSavedScan({ supabase: mockSupabase(), id: 'scan-1', name: '   ' }))
      .rejects.toThrow('A scan name is required.')
  })

  it('creates a signed URL through the private bucket', async () => {
    const sb = mockSupabase()
    const url = await createSheetImageSignedUrl({ supabase: sb, path: 'u1/scan-1/sheet-1.jpg' })
    expect(url).toBe('signed:u1/scan-1/sheet-1.jpg')
    expect(sb.calls.storageSigned[0].name).toBe(SAVED_SCANS_BUCKET)
  })
})

describe('deleteSavedScan', () => {
  it('removes only the scan folder objects then the row itself', async () => {
    const sb = mockSupabase()
    await deleteSavedScan({ supabase: sb, scan: { id: 'scan-1', user_id: 'u1', owner_id: 'owner-1' } })
    expect(sb.calls.storageLists).toEqual([{ name: SAVED_SCANS_BUCKET, path: 'u1/scan-1', options: { limit: 100, offset: 0 } }])
    expect(sb.calls.storageRemoves).toEqual([{ name: SAVED_SCANS_BUCKET, paths: ['u1/scan-1/img.jpg'] }])
    expect(sb.calls.from[0]).toBe(SAVED_SCANS_TABLE)
    // No member, attendance, or extraction-quota table is ever touched.
    const touchedTables = sb.calls.from
    expect(touchedTables).not.toContain('members')
    expect(touchedTables.some((t) => /attendance/.test(String(t)))).toBe(false)
    expect(touchedTables).not.toContain('paper_scan_extraction')
  })

  it('still deletes the row when the folder has no objects', async () => {
    const sb = mockSupabase()
    sb.storage.from.mockImplementation((name) => ({
      upload: async () => ({ data: {}, error: null }),
      remove: async () => ({ data: [], error: null }),
      list: async () => ({ data: [], error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null })
    }))
    await expect(deleteSavedScan({ supabase: sb, scan: { id: 'scan-1', user_id: 'u1' } })).resolves.toBe(true)
  })
})

describe('reopen helpers', () => {
  it('extracts rows, exclusions, and usage metadata from a saved record', () => {
    const record = buildSavedScanRecord({ scanId: 'scan-1', userId: 'u1', ownerId: 'owner-1', name: 'x', sheets: [okSheet], resultsBySheet: { 'sheet-1': okResult } })
    expect(rowsFromSavedScan(record, 'sheet-1')).toHaveLength(1)
    expect(excludedIndicesFromSavedScan(record, 'sheet-1')).toEqual([2])
    expect(usageMetadataFromSavedScan(record, 'sheet-1').promptTokenCount).toBe(12)
    expect(rowsFromSavedScan(record, 'missing-sheet')).toEqual([])
  })
})

// Safeguard: the service must never invent writes to member/attendance tables.
describe('data-scope guarantees', () => {
  it('never queries or writes member or attendance tables from any operation', async () => {
    const sb = mockSupabase()
    await savePaperScan({ supabase: sb, scanId: 'scan-1', userId: 'u1', ownerId: 'owner-1', name: 'x', sheets: [okSheet], resultsBySheet: { 'sheet-1': okResult }, uploadImage: async ({ supabase, userId, scanId, sheetId }) => `${userId}/${scanId}/${sheetId}.jpg` })
    await listSavedScans({ supabase: sb, ownerId: 'owner-1' })
    await deleteSavedScan({ supabase: sb, scan: { id: 'scan-x', user_id: 'u1' } })
    const touched = sb.calls.from
    expect(new Set(touched).size).toBeGreaterThan(0)
    for (const table of touched) {
      expect(table).not.toMatch(/^(members|attendance|paper_scan_extraction)$/)
    }
  })
})
