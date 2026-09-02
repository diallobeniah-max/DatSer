import { describe, expect, it } from 'vitest'
import { deriveCsvImportMemberProvenance, fetchRecentCsvImportMemberProvenance, getRecentCsvImportMemberProvenance, rememberCsvImportMemberProvenance } from './csvImportMemberProvenance'

const row = {
  importRowId: 'r7', sheet: 'Sheet 4', rowNumber: 7,
  bulkCreate: { memberId: 'new-1', sourceImportId: 'history-1', sourceSheet: 'Sheet 4', sourceRow: 7, createdAt: '2026-08-29T12:00:00Z' },
}

const makeStorage = () => {
  const values = new Map()
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
}

describe('CSV import member provenance', () => {
  it('derives persisted sheet and row context only for members created by the import', () => {
    expect(deriveCsvImportMemberProvenance([row, { importRowId: 'old' }], 'history-1')).toEqual({
      'new-1': expect.objectContaining({ sessionId: 'history-1', sourceSheet: 'Sheet 4', sourceRow: 7 }),
    })
  })

  it('restores the current workspace context after refresh and never leaks it to another workspace', () => {
    const storage = makeStorage()
    rememberCsvImportMemberProvenance({ ownerId: 'workspace-a', sessionId: 'history-1', rows: [row], storage })
    expect(getRecentCsvImportMemberProvenance({ ownerId: 'workspace-a', storage })).toHaveProperty('new-1')
    expect(getRecentCsvImportMemberProvenance({ ownerId: 'workspace-b', storage })).toEqual({})
  })

  it('expires the presentation-only recent-import treatment', () => {
    const storage = makeStorage()
    rememberCsvImportMemberProvenance({ ownerId: 'workspace-a', sessionId: 'history-1', rows: [row], storage })
    expect(getRecentCsvImportMemberProvenance({ ownerId: 'workspace-a', storage, now: Date.now() + (8 * 24 * 60 * 60 * 1000) })).toEqual({})
  })

  it('fetches and restores provenance across devices from server-side import sessions when localStorage is empty', async () => {
    const storage = makeStorage()
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: 'sess-remote-1', import_rows: [row], updated_at: new Date().toISOString() }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }
    const result = await fetchRecentCsvImportMemberProvenance({ supabase, ownerId: 'workspace-a', storage })
    expect(result).toHaveProperty('new-1')
    expect(result['new-1']).toMatchObject({ memberId: 'new-1', sourceSheet: 'Sheet 4', sourceRow: 7 })
    expect(getRecentCsvImportMemberProvenance({ ownerId: 'workspace-a', storage })).toHaveProperty('new-1')
  })
})
