// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260814122618_20260813170000_harden_paper_scan_final_save.sql'), 'utf8')

const functionBody = (name) => {
  const start = sql.indexOf(`function public.${name}(`)
  expect(start, `${name} must be defined in 1700 migration`).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('$$;', start) + 3)
}

describe('workspace member-code allocator hardening and concurrency lock isolation', () => {
  const allocator = functionBody('ensure_workspace_member_codes')
  const singleAllocator = functionBody('ensure_workspace_member_code')
  const belongsHelper = functionBody('member_belongs_to_workspace')
  const paperScanStep = functionBody('paper_scan_execute_save_step')

  it('uses the exact same deterministic member-scoped advisory lock key formula across allocator and paper scan', () => {
    // Both must use hashtextextended(member_id::text, 0)
    expect(allocator).toContain('perform pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 0));')
    expect(paperScanStep).toContain('perform pg_advisory_xact_lock(hashtextextended(s.member_id::text, 0));')
  })

  it('maintains a distinct workspace-level lock for sequential ordinal generation acquired after member locks', () => {
    expect(allocator).toContain("perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));")
    const memberLockPos = allocator.indexOf('perform pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 0));')
    const wsLockPos = allocator.indexOf("perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));")
    expect(memberLockPos).toBeGreaterThan(0)
    expect(wsLockPos).toBeGreaterThan(memberLockPos)
  })

  it('rejects foreign workspace UUID claims before any code allocation occurs', () => {
    expect(allocator).toMatch(/from public\.workspace_member_codes\s+where member_id = v_member\.member_id and workspace_owner_id <> p_owner_id/)
    expect(allocator).toContain("raise exception 'Member id % belongs to another workspace'")
  })

  it('rejects excluded provenance member UUIDs before any code allocation occurs', () => {
    expect(allocator).toContain('from public.workspace_member_provenance_exclusions where member_id = v_member.member_id')
    expect(allocator).toContain("raise exception 'Member id % is excluded from workspace provenance'")
  })

  it('requires server-proven workspace ownership via member_belongs_to_workspace', () => {
    expect(allocator).toContain('if not public.member_belongs_to_workspace(p_owner_id, v_member.member_id) then')
    expect(allocator).toContain("raise exception 'Member id % does not belong to authorized workspace %'")
  })

  it('proves workspace ownership across code claims, provenance overrides, and registered month tables', () => {
    expect(belongsHelper).toMatch(/from public\.workspace_member_codes\s+where workspace_owner_id = p_owner_id and member_id = p_member_id/)
    expect(belongsHelper).toContain('from public.workspace_member_provenance_overrides')
    expect(belongsHelper).toMatch(/from public\.workspace_month_tables\s+where owner_id = p_owner_id/)
    expect(belongsHelper).toContain('workspace_owner_id = $2')
  })

  it('delegates single-member allocation to the hardened batch allocator with non-null ID check', () => {
    expect(singleAllocator).toContain('from public.ensure_workspace_member_codes(')
    expect(singleAllocator).toContain("raise exception 'A canonical member id is required for member-code allocation'")
  })

  it('ensures paper-scan member creation acquires member lock before collision check and insert', () => {
    const memberCreateBlock = paperScanStep.slice(paperScanStep.indexOf("if s.kind = 'member-create' then"))
    const lockPos = memberCreateBlock.indexOf('perform pg_advisory_xact_lock(hashtextextended(s.member_id::text, 0));')
    const insertPos = memberCreateBlock.indexOf('insert into public.')
    const codeAllocPos = memberCreateBlock.indexOf('perform public.ensure_workspace_member_code(')

    expect(lockPos).toBeGreaterThan(0)
    expect(insertPos).toBeGreaterThan(lockPos)
    expect(codeAllocPos).toBeGreaterThan(insertPos)
  })
})
