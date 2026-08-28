import { describe, expect, it, vi } from 'vitest'
import { countPersistedCsvImportImages, deleteCsvImportSession, hydrateSourceImages, updateCsvImportReviewRows, uploadSourceImages } from './csvImportHistory'

const file = (name = 'Sunday Sheet.png', type = 'image/png') => new File(['pixels'], name, { type })

const storageClient = ({ uploadError = null, signedUrl = 'signed' } = {}) => {
  const upload = vi.fn().mockResolvedValue({ error: uploadError })
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl }, error: null })
  const from = vi.fn(() => ({ upload, createSignedUrl }))
  return { supabase: { storage: { from } }, from, upload, createSignedUrl }
}

describe('CSV import source image persistence', () => {
  it('uses a private owner/session/sheet path without member data', async () => {
    const { supabase, upload } = storageClient()
    const [saved] = await uploadSourceImages({ supabase, ownerId: 'owner-1', sessionId: 'session-1', sheetImages: { 'Sheet 1': [file()] } })
    expect(upload.mock.calls[0][0]).toBe('owner-1/session-1/Sheet-1/01-Sunday-Sheet.png')
    expect(saved).toMatchObject({ bucket: 'csv-import-sources', sheetKey: 'Sheet 1', status: 'saved', order: 0 })
  })

  it('keeps explicit multi-sheet associations', async () => {
    const { supabase } = storageClient()
    const saved = await uploadSourceImages({ supabase, ownerId: 'o', sessionId: 's', sheetImages: { North: [file('n.png')], South: [file('s.png')] } })
    expect(saved.map((image) => image.sheetKey)).toEqual(['North', 'South'])
  })

  it('does not re-upload restored descriptors', async () => {
    const { supabase, upload } = storageClient()
    const saved = await uploadSourceImages({ supabase, ownerId: 'o', sessionId: 's', sheetImages: { North: [{ path: 'o/s/North/01.png', name: '01.png', size: 2 }] } })
    expect(saved).toEqual([])
    expect(upload).not.toHaveBeenCalled()
  })

  it('uses upsert so a history-only retry is stable', async () => {
    const { supabase, upload } = storageClient()
    await uploadSourceImages({ supabase, ownerId: 'o', sessionId: 's', sheetImages: { North: [file('n.png')] } })
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: true, contentType: 'image/png' })
  })

  it('emits uploading then saved states', async () => {
    const { supabase } = storageClient()
    const states = []
    await uploadSourceImages({ supabase, ownerId: 'o', sessionId: 's', sheetImages: { North: [file()] }, onImageStatus: (state) => states.push(state.status) })
    expect(states).toEqual(['uploading', 'saved'])
  })

  it('emits failed and rejects an upload error', async () => {
    const { supabase } = storageClient({ uploadError: new Error('denied') })
    const states = []
    await expect(uploadSourceImages({ supabase, ownerId: 'o', sessionId: 's', sheetImages: { North: [file()] }, onImageStatus: (state) => states.push(state.status) })).rejects.toThrow('denied')
    expect(states).toEqual(['uploading', 'failed'])
  })

  it('counts only durable persisted descriptors', () => {
    expect(countPersistedCsvImportImages({ source_images: [{ path: 'a', bucket: 'csv-import-sources' }, { name: 'pending.png' }, null] })).toBe(1)
  })

  it('regenerates signed URLs each time a saved import opens', async () => {
    const { supabase, createSignedUrl } = storageClient({ signedUrl: 'fresh-url' })
    const hydrated = await hydrateSourceImages({ supabase, sourceImages: [{ sheetKey: 'Sheet 1', path: 'o/s/Sheet-1/01.png', bucket: 'csv-import-sources' }] })
    expect(createSignedUrl).toHaveBeenCalledWith('o/s/Sheet-1/01.png', 3600)
    expect(hydrated['Sheet 1'][0].previewUrl).toBe('fresh-url')
  })

  it('continues past a missing signed URL', async () => {
    const from = vi.fn(() => ({ createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: new Error('missing') }) }))
    expect(await hydrateSourceImages({ supabase: { storage: { from } }, sourceImages: [{ sheet: 'Sheet 1', path: 'missing' }] })).toEqual({})
  })

  it('supports legacy sheet metadata on reopen', async () => {
    const { supabase } = storageClient()
    const hydrated = await hydrateSourceImages({ supabase, sourceImages: [{ sheet: 'Legacy', path: 'session/Legacy/01.png' }] })
    expect(hydrated.Legacy[0].sheetKey).toBe('Legacy')
  })

  it('persists attention verification inside the existing import_rows JSON', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'session-1', import_rows: [{ importRowId: 'r1', attentionVerified: true }] }, error: null })
    const select = vi.fn(() => ({ single }))
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn(() => ({ eq }))
    const supabase = { from: vi.fn(() => ({ update })) }
    const importRows = [{ importRowId: 'r1', edited: { notes: 'Review phone' }, attentionVerified: true }]

    await updateCsvImportReviewRows({ supabase, sessionId: 'session-1', importRows })

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ import_rows: importRows }))
    expect(eq).toHaveBeenCalledWith('id', 'session-1')
  })

  it('deletes only the selected history row before cleaning up its private source images', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null })
    const selectCurrent = vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { source_images: [{ bucket: 'csv-import-sources', path: 'owner/session-1/Sheet-1/01.png' }] }, error: null }) })) }))
    const selectDeleted = vi.fn(() => Promise.resolve({ data: [{ id: 'session-1' }], error: null }))
    const deleteRow = vi.fn(() => ({ eq: vi.fn(() => ({ select: selectDeleted })) }))
    const from = vi.fn(() => ({ select: selectCurrent, delete: deleteRow }))
    const supabase = { from, storage: { from: vi.fn(() => ({ remove })) } }

    await expect(deleteCsvImportSession({ supabase, sessionId: 'session-1' })).resolves.toEqual({ storageWarning: '' })
    expect(from).toHaveBeenCalledWith('csv_import_sessions')
    expect(deleteRow).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(['owner/session-1/Sheet-1/01.png'])
  })
})
