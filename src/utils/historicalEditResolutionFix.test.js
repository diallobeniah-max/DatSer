import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationName = '20260807150000_fix_historical_edit_resolution.sql'
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
  migrationName
)

const readMigration = () => fs.readFileSync(migrationPath, 'utf8')

describe('historical edit resolution fix (Bug 3)', () => {
  it('exists as a corrective migration', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  it('A: keeps workspace authorization strict (authorize_workspace_actor)', () => {
    const sql = readMigration()
    expect(sql).toContain('perform public.authorize_workspace_actor(p_owner_id)')
  })

  it('B/E: row ownership is proven via owner OR accepted/active collaborator membership', () => {
    const sql = readMigration()
    // Rows are scoped to the authorized workspace via the collaborator membership
    // of the row's user_id (deterministic ownership proof).
    expect(sql).toContain('select collaborator_user_id from public.collaborators')
    expect(sql).toContain("status in (''accepted'', ''active'')")
    expect(sql).toContain('user_id = $2 or user_id in (')
    // user_month_tables must NOT be used as an ownership proof (it is shared).
    expect(sql).not.toMatch(/from public\.user_month_tables umt/)
  })

  it('B: exact source-row id lookup is workspace-scoped and not owner-only', () => {
    const sql = readMigration()
    const idLookup = sql.match(/id = \$1 and deleted_at is null[\s\S]*?using p_member_id, p_owner_id/)
    expect(idLookup).not.toBeNull()
    expect(idLookup[0]).toContain('collaborator_user_id')
  })

  it('D: recovery requires exactly ONE safe workspace-scoped match', () => {
    const sql = readMigration()
    expect(sql).toContain("if v_count <> 1 then")
    expect(sql).toContain("raise exception 'Member recovery found % matching rows; update was not applied', v_count")
  })

  it('E: no cross-workspace / ambiguous updates (exact match recovery only)', () => {
    const sql = readMigration()
    // Recovery uses exact equality (lower(btrim(...)) = lower(...)); no fuzzy LIKE scan.
    expect(sql).toContain('lower(btrim(%I)) = lower($1)')
    const fuzzy = sql.match(/where deleted_at is null[\s\S]*?lower\(btrim\(%I\)\)[\s\S]*?like/i)
    expect(fuzzy).toBeNull()
  })

  it('F: resilient post-verification no longer gates on user_id = p_owner_id', () => {
    const sql = readMigration()
    expect(sql).not.toMatch(/where id = \$1 and user_id = \$2/)
    expect(sql).toMatch(/where id = \$1 and deleted_at is null/)
    expect(sql).toMatch(/select to_jsonb\(t\) from %I t where id = \$1/)
  })

  it('keeps grants for authenticated and revokes from anon/public', () => {
    const sql = readMigration()
    expect(sql).toContain('revoke all on function public.resolve_member_update_target(text, uuid, uuid, jsonb) from public')
    expect(sql).toContain('grant execute on function public.update_member_bundle_resilient(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb, jsonb) to authenticated')
  })
})
