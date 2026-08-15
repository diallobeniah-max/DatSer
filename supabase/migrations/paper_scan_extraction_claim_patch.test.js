// @vitest-environment node
// Static design checks for the Paper Scan extraction-claim patch migration.
// The migration is NOT applied here (live DB handled separately); these tests
// pin the SQL contract: boolean-EXISTS duplicate check (no integer->UUID),
// anonymous rejection, preserved authorization, and no unrelated changes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260815160000_patch_paper_scan_duplicate_guard_and_anonymous_check.sql'), 'utf8')

describe('paper_scan_extraction_claim patch migration', () => {
  it('is additive and never touches members, attendance, provenance, or ownership', () => {
    expect(SQL).toMatch(/create or replace function public\.claim_paper_scan_extraction/)
    expect(SQL).not.toMatch(/DROP TABLE/i)
    expect(SQL).not.toMatch(/DELETE FROM/i)
    expect(SQL).not.toMatch(/ALTER TABLE/i)
    expect(SQL).not.toMatch(/workspace_owner_id =/i)
    expect(SQL).not.toMatch(/UPDATE public\."August_2026"/i)
  })

  it('uses a boolean EXISTS duplicate check and never assigns an integer into a UUID', () => {
    expect(SQL).toMatch(/v_duplicate BOOLEAN/)
    expect(SQL).toMatch(/SELECT EXISTS/)
    expect(SQL).toMatch(/INTO v_duplicate/)
    expect(SQL).toMatch(/IF v_duplicate THEN/)
    // The ONLY id assignment is the UUID RETURNING id.
    expect(SQL).toMatch(/RETURNING id INTO v_new_id/)
    // The buggy integer assignment pattern must be absent from the CODE body.
    // (The header comment documents the bug text; assert on the function body only.)
    const body = SQL.slice(SQL.indexOf('create or replace function'))
    expect(body).not.toMatch(/SELECT 1 INTO v_new_id/i)
    expect(body).not.toMatch(/SELECT 1\s+INTO\s+v_new_id/i)
  })

  it('rejects anonymous Supabase users before any quota or ledger work', () => {
    expect(SQL).toMatch(/auth\.jwt\(\) ->> 'is_anonymous' = 'true'/)
    expect(SQL).toMatch(/RAISE EXCEPTION 'Anonymous accounts cannot use extraction'/)
    // The anonymous check appears before the duplicate check and quota insert.
    const anonIndex = SQL.indexOf("auth.jwt() ->> 'is_anonymous'")
    const dupIndex = SQL.indexOf('SELECT EXISTS')
    expect(anonIndex).toBeGreaterThan(-1)
    expect(dupIndex).toBeGreaterThan(anonIndex)
  })

  it('preserves workspace authorization and grants', () => {
    expect(SQL).toMatch(/authorize_workspace_actor\(p_owner_id\)/)
    expect(SQL).toMatch(/SECURITY DEFINER/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_paper_scan_extraction\(UUID, TEXT, TEXT\) TO authenticated/)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.claim_paper_scan_extraction\(UUID, TEXT, TEXT\) FROM PUBLIC/)
    expect(SQL).not.toMatch(/TO anon/i)
    expect(SQL).not.toMatch(/service_role/i)
  })

  it('keeps duplicate / quota / unique-violation result paths intact', () => {
    expect(SQL).toMatch(/'duplicate'::TEXT/)
    expect(SQL).toMatch(/'quota_exceeded'::TEXT/)
    expect(SQL).toMatch(/WHEN unique_violation THEN/)
    expect(SQL).toMatch(/notify pgrst, 'reload schema'/i)
  })
})
