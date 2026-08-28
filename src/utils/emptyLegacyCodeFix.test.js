import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationName = '20260807194507_fix_empty_legacy_member_code_allocation.sql'
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
  migrationName
)

const readMigration = () => fs.readFileSync(migrationPath, 'utf8')

describe('empty legacy_code member-code allocation fix (Bug 4)', () => {
  it('exists as a corrective migration', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  it('C/D: falls back to the generated candidate so empty legacy_code never reaches INSERT', () => {
    const sql = readMigration()
    // The insert must use an effective legacy derived from the candidate when
    // no legacy_code is supplied.
    expect(sql).toContain("v_effective_legacy := coalesce(nullif(btrim(coalesce(v_member.legacy_code, '')), ''), v_candidate)")
    expect(sql).toContain('v_effective_legacy,')
    // The candidate is always [A-Z0-9]+ regardless of format.
    expect(sql).toContain('member_code_letters(v_next_ordinal, v_length)')
    expect(sql).toContain("v_candidate := lpad(v_next_ordinal::text, v_width, '0')")
  })

  it('A: preserves a supplied non-empty legacy_code and keeps it as an alias when it differs', () => {
    const sql = readMigration()
    expect(sql).toMatch(/nullif\(btrim\(coalesce\(v_member\.legacy_code, ''\)\), ''\) is not null[\s\S]*array\[upper\(v_member\.legacy_code\)\]/)
  })

  it('does not weaken the legacy_code check constraint', () => {
    const sql = readMigration()
    expect(sql).not.toMatch(/drop constraint.*workspace_member_codes_legacy_code_check/i)
    expect(sql).not.toMatch(/alter (table|column).*workspace_member_codes_legacy_code_check/i)
  })

  it('E: keeps existing-allocation guards (skip existing + conflict do nothing)', () => {
    const sql = readMigration()
    expect(sql).toMatch(/if exists[\s\S]*existing\.member_id = v_member\.member_id[\s\S]*then\s*continue/)
    expect(sql).toContain('on conflict (workspace_owner_id, member_id) do nothing')
  })

  it('keeps grants for authenticated and revokes from anon/public', () => {
    const sql = readMigration()
    expect(sql).toContain('revoke all on function public.ensure_workspace_member_codes(uuid, jsonb) from public, anon')
    expect(sql).toContain('grant execute on function public.ensure_workspace_member_codes(uuid, jsonb) to authenticated')
  })
})
