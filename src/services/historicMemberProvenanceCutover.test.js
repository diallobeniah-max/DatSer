// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260813170000_harden_paper_scan_final_save.sql'), 'utf8')

const body = (name) => {
  const start = migration.lastIndexOf(`create or replace function public.${name}(`)
  expect(start, `${name} must be defined by the hardening migration`).toBeGreaterThanOrEqual(0)
  return migration.slice(start, migration.indexOf('$$;', start) + 3)
}

describe('historic member provenance reconciliation and RLS cutover', () => {
  const reconcile = body('reconcile_month_member_workspace_provenance')
  const guard = body('assert_historic_member_provenance_cutover')

  it('backfills only canonical member ids with exactly one server-owned workspace-code owner', () => {
    expect(reconcile).toContain('from public.workspace_member_codes')
    expect(reconcile).toContain('having count(distinct workspace_owner_id) = 1')
    expect(reconcile).toContain('member_row.workspace_owner_id is null')
  })

  it('does not use collaborator identity, legacy user_id, or actor fields as backfill evidence', () => {
    expect(reconcile).not.toContain('collaborator')
    expect(reconcile).not.toContain('user_id')
    expect(reconcile).not.toContain('created_by')
    expect(reconcile).not.toContain('updated_by')
  })

  it('classifies unmapped, ambiguous, and explicitly excluded identities separately', () => {
    expect(reconcile).toContain("'unmapped'")
    expect(reconcile).toContain("candidate_owner_count = 0")
    expect(reconcile).toContain("'ambiguous'")
    expect(reconcile).toContain('candidate_owner_count > 1')
    expect(reconcile).toContain("'excluded'")
    expect(reconcile).toContain('where workspace_owner_id is null and is_excluded')
  })

  it('detects a contradictory pre-existing workspace owner or exclusion clash rather than overwriting it', () => {
    expect(reconcile).toContain("'conflicts'")
    expect(reconcile).toContain('workspace_owner_id <> candidate_owner')
    expect(reconcile).toContain('workspace_owner_id is not null and is_excluded')
  })

  it('keeps reconciliation idempotent by filling only null provenance and leaving exclusions null', () => {
    expect(reconcile).toContain('set workspace_owner_id = evidence.owner_id')
    expect(reconcile).toContain('and member_row.workspace_owner_id is null')
    expect(reconcile).not.toMatch(/set workspace_owner_id = .*exclusion/i)
  })

  it('validates both overrides and exclusions tables exist and checks for zero overlap before reconciliation', () => {
    expect(reconcile).toContain("to_regclass('public.workspace_member_provenance_overrides') is null")
    expect(reconcile).toContain("to_regclass('public.workspace_member_provenance_exclusions') is null")
    expect(reconcile).toContain("p_table_name !~ '^[A-Z][a-z]+_[0-9]{4}$'")
    expect(reconcile).toContain("public.month_table_has_column(p_table_name, 'id')")
    expect(reconcile).toContain("public.month_table_has_column(p_table_name, 'workspace_owner_id')")

    expect(guard).toContain('from public.workspace_member_provenance_overrides o')
    expect(guard).toContain('join public.workspace_member_provenance_exclusions e on e.member_id = o.member_id')
    expect(guard).toContain('if v_overlap > 0 then')
    expect(guard).toContain("message = 'Historic member provenance cutover blocked: canonical member exists in both overrides and exclusions'")
  })

  it('defensively skips any excluded member when applying operator ownership overrides', () => {
    expect(reconcile).toContain('not exists (')
    expect(reconcile).toContain('from public.workspace_member_provenance_exclusions ex')
    expect(reconcile).toContain('where ex.member_id = override.member_id')
  })

  it('keeps the reconciliation capability off every browser role', () => {
    expect(migration).toContain('revoke all on function public.reconcile_month_member_workspace_provenance(text) from public, anon, authenticated;')
    expect(migration).not.toMatch(/grant execute on function public\.reconcile_month_member_workspace_provenance\(text\) to authenticated/i)
  })

  it('runs the safe backfill for every canonical month relation before registry adoption', () => {
    const registry = body('reconcile_workspace_month_registry')
    expect(registry).toContain('perform public.reconcile_month_member_workspace_provenance(r.table_name);')
    expect(registry).toContain("c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'")
  })

  it('rechecks every canonical table during the cutover precondition', () => {
    expect(guard).toContain('for r in')
    expect(guard).toContain("c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'")
    expect(guard).toContain('v_stats := public.reconcile_month_member_workspace_provenance(r.table_name);')
  })

  it('aborts on unresolved unmapped rows and accounts for quarantined rows in detail', () => {
    expect(guard).toContain('if v_unmapped <> 0')
    expect(guard).toContain("message = 'Historic member provenance cutover blocked'")
    expect(guard).toContain("errcode = 'P0001'")
    expect(guard).toContain("'quarantined_rows', v_excluded")
  })

  it('aborts on ambiguous identities and conflicting provenance', () => {
    expect(guard).toContain('v_ambiguous <> 0')
    expect(guard).toContain('v_conflicts <> 0')
    expect(guard).toContain("'ambiguous_rows', v_ambiguous")
    expect(guard).toContain("'conflicting_rows', v_conflicts")
  })

  it('places the cutover guard after registry reconciliation but before strict month-table RLS execution', () => {
    const guardCall = migration.indexOf('select public.assert_historic_member_provenance_cutover();')
    const rlsExecution = migration.indexOf('perform public.harden_month_workspace_rls(r.table_name);')
    expect(guardCall).toBeGreaterThan(migration.indexOf('select public.reconcile_workspace_month_registry();'))
    expect(guardCall).toBeLessThan(rlsExecution)
  })

  it('does not create an RLS fallback for null workspace provenance', () => {
    const rls = body('harden_month_workspace_rls')
    expect(rls).not.toContain('workspace_owner_id is null')
    expect(rls).toContain('public.is_permanent_workspace_actor(workspace_owner_id)')
  })

  it('preserves the dual-workspace boundary in the final target resolver', () => {
    const resolver = body('resolve_member_update_target')
    expect(resolver).toContain('workspace_owner_id = $2')
    expect(resolver).not.toContain('user_id =')
    expect(resolver).not.toContain('collaborator_user_id')
  })

  it('does not delete, merge, or rewrite member profile or attendance content during reconciliation', () => {
    expect(reconcile).not.toMatch(/\bdelete\b/i)
    expect(reconcile).not.toMatch(/\bmerge\b/i)
    expect(reconcile).not.toContain('attendance_')
    expect(reconcile).not.toContain("'Full Name'")
  })

  it('keeps the guard private to the migration owner', () => {
    expect(migration).toContain('revoke all on function public.assert_historic_member_provenance_cutover() from public, anon, authenticated;')
    expect(migration).not.toMatch(/grant execute on function public\.assert_historic_member_provenance_cutover\(\) to authenticated/i)
  })
})
