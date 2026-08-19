// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260818000000_fix_paper_scan_saved_delete_cascade.sql'), 'utf8')
const FINAL_SAVE_SQL = readFileSync(join(HERE, '20260813170000_harden_paper_scan_final_save.sql'), 'utf8')

describe('saved scan deletion cascade', () => {
  it('cascades only from the saved scan to its private Final Save operation ledger', () => {
    expect(SQL).toContain('drop constraint if exists paper_scan_save_operations_saved_scan_id_fkey')
    expect(SQL).toMatch(/foreign key \(saved_scan_id\)[\s\S]*references public\.paper_scan_saved\(id\)[\s\S]*on delete cascade/i)
    expect(FINAL_SAVE_SQL).toMatch(/operation_id uuid not null references public\.paper_scan_save_operations\(id\) on delete cascade/i)
  })

  it('does not add a member or attendance mutation or a browser ledger delete grant', () => {
    expect(SQL).not.toMatch(/\b(delete|update|insert)\s+(from\s+)?public\.(members|attendance)/i)
    expect(SQL).not.toMatch(/grant delete on public\.paper_scan_save_operations/i)
    expect(SQL).toMatch(/revoke delete on public\.paper_scan_save_operations, public\.paper_scan_save_steps/i)
  })
})
