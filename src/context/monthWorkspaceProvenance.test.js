// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const appContext = fs.readFileSync(path.join(root, 'src/context/AppContext.jsx'), 'utf8')
const provenanceFixture = fs.readFileSync(path.join(root, 'supabase/tests/paper_scan_final_save_provenance.sql'), 'utf8')

describe('month workspace provenance regression boundary', () => {
  it('stamps normal new members with the immutable workspace owner rather than the editing actor', () => {
    const start = appContext.indexOf('const buildMemberTableRow')
    const end = appContext.indexOf('const sanitizeQueuedMemberInsert', start)
    const builder = appContext.slice(start, end)
    expect(builder).toContain('workspaceOwnerId = null')
    expect(builder).toContain('workspace_owner_id: workspaceOwnerId || userId')
    expect(appContext).toContain('workspaceOwnerId: dataOwnerId || user?.id')
  })

  it('keeps the disposable PostgreSQL A/B dual-collaborator exploit fixture alongside the migration', () => {
    expect(provenanceFixture).toContain('collaborator_c')
    expect(provenanceFixture).toContain('B operation must reject A member X')
    expect(provenanceFixture).toContain('B cross-month attendance must reject A member X')
    expect(provenanceFixture).toContain('B target resolver must reject A member X')
    expect(provenanceFixture).toContain('B soft delete must reject A member X')
    expect(provenanceFixture).toContain('Pending collaborator must fail month RLS predicate')
    expect(provenanceFixture).toContain('Inactive collaborator must fail month RLS predicate')
    expect(provenanceFixture).toContain('Anonymous user must fail month RLS predicate')
    expect(provenanceFixture).toContain('rollback;')
  })
})
