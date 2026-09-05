// @vitest-environment node
// Static design checks for the Phase 4C Saved Scans migration. The migration is
// NOT applied here (live DB is off-limits); these tests pin the SQL contract:
// a private per-user scan table with workspace-aware RLS, a PRIVATE storage
// bucket, storage-object RLS scoped to the writer's own folder, idempotent
// client-keyed rows, and a delete surface that can only remove the scan's own
// objects. They also prove the migration never touches members, attendance, or
// the extraction quota ledger.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260813112643_20260812_paper_scan_saved_scans.sql'), 'utf8').replace(/\r\n/g, '\n')

describe('paper_scan_saved_scans migration', () => {
  it('creates the saved scan table with every persisted concept', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.paper_scan_saved/)
    expect(SQL).toMatch(/id UUID PRIMARY KEY/)
    expect(SQL).toMatch(/user_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/)
    expect(SQL).toMatch(/owner_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/)
    expect(SQL).toMatch(/name TEXT NOT NULL DEFAULT 'Saved scan'/)
    expect(SQL).toMatch(/sheet_images JSONB NOT NULL DEFAULT '\[\]'::JSONB/)
    expect(SQL).toMatch(/extraction JSONB NOT NULL DEFAULT '\{\}'::JSONB/)
    expect(SQL).toMatch(/review_state JSONB NOT NULL DEFAULT '\{\}'::JSONB/)
    expect(SQL).toMatch(/attendance JSONB NOT NULL DEFAULT '\{\}'::JSONB/)
    expect(SQL).toMatch(/usage_metadata JSONB NOT NULL DEFAULT '\{\}'::JSONB/)
  })

  it('keeps the id client-generated so repeated Save is an idempotent upsert', () => {
    // No server-side default: the client session id IS the PK.
    expect(SQL).toMatch(/id UUID PRIMARY KEY/)
    expect(SQL).not.toMatch(/id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  })

  it('enables RLS and gates every policy on the caller plus workspace authorization', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.paper_scan_saved ENABLE ROW LEVEL SECURITY/)
    for (const policy of [
      'Users read their own saved scans',
      'Users save their own scans',
      'Users update their own saved scans',
      'Users delete their own saved scans'
    ]) {
      expect(SQL).toMatch(new RegExp(policy))
    }
    // Every policy combines the caller identity with the workspace helper.
    expect(SQL).toMatch(/auth\.uid\(\) = user_id AND public\.can_access_workspace\(owner_id\)/)
  })

  it('reuses the existing non-raising workspace helper instead of inventing new auth logic', () => {
    expect(SQL).toMatch(/can_access_workspace\(owner_id\)/)
    expect(SQL).not.toContain('service_role')
    expect(SQL).not.toMatch(/SUPABASE_SERVICE_ROLE/i)
  })

  it('creates a PRIVATE bucket for sheet images', () => {
    expect(SQL).toMatch(/INSERT INTO storage\.buckets/)
    expect(SQL).toMatch(/'paper-scan-saved'/)
    // Values list ordering: (id, name, public, ...) — public MUST be FALSE.
    expect(SQL).toMatch(/'paper-scan-saved',\n\s*'paper-scan-saved',\n\s*FALSE/)
    expect(SQL).toMatch(/ON CONFLICT \(id\) DO UPDATE SET\s*\n\s*public = EXCLUDED\.public/)
  })

  it('scopes storage-object RLS to the writer\u2019s own first path segment only', () => {
    expect(SQL).toMatch(/\(storage\.foldername\(name\)\)\[1\] = \(SELECT auth\.uid\(\)::TEXT\)/)
    // No public read policy for these images.
    expect(SQL).not.toMatch(/FOR SELECT TO PUBLIC/)
    expect(SQL).not.toMatch(/getPublicUrl/) // the client only gets signed URLs
  })

  it('keeps the delete surface limited to the scan row and its own objects', () => {
    // The DELETE policy only touches paper_scan_saved rows the caller owns.
    const deletePolicy = /DROP POLICY IF EXISTS "Users delete their own saved scans"[\s\S]*?FOR DELETE[\s\S]*?USING \(auth\.uid\(\) = user_id AND public\.can_access_workspace\(owner_id\)\)/
    expect(SQL).toMatch(deletePolicy)
    expect(SQL).not.toMatch(/DROP TABLE.*members/i)
    expect(SQL).not.toMatch(/DROP TABLE.*attendance/i)
    expect(SQL).not.toMatch(/DELETE FROM public\.members/)
    expect(SQL).not.toMatch(/DELETE FROM.*attendance/i)
    expect(SQL).not.toMatch(/paper_scan_extraction/i)
  })

  it('grants the browser session CRUD but never anything beyond authenticated', () => {
    expect(SQL).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.paper_scan_saved TO authenticated/)
    expect(SQL).not.toMatch(/GRANT.*TO anon/)
    expect(SQL).not.toMatch(/GRANT.*TO public/)
    expect(SQL).not.toMatch(/GRANT.*service_role/)
  })

  it('touches no other workspace data and keeps the schema cache fresh', () => {
    expect(SQL).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.members/)
    expect(SQL).not.toMatch(/ALTER TABLE public\.members/)
    expect(SQL).toMatch(/NOTIFY pgrst, 'reload schema'/)
  })
})
