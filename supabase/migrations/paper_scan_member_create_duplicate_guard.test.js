// @vitest-environment node
// Static design checks for the Paper Scan member-create duplicate guard migration.
// The migration is NOT applied here (live DB is off-limits); these tests pin the
// SQL contract: additive helpers, identity-scoped lock, fresh workspace-scoped
// candidate recheck before INSERT, structured BLOCKED_DUPLICATE result, confirmed
// duplicate override escape hatch, and preservation of the applied 1700 semantics
// (same signature, authorization, idempotency, member-code behavior).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260815134507_harden_paper_scan_member_create_duplicate_guard.sql'), 'utf8').replace(/\r\n/g, '\n')

describe('paper_scan_member_create_duplicate_guard migration', () => {
  it('is additive and never touches members, attendance, codes, or provenance tables', () => {
    expect(SQL).toMatch(/create or replace function public\.paper_scan_execute_save_step/)
    expect(SQL).not.toMatch(/DROP TABLE/i)
    expect(SQL).not.toMatch(/DELETE FROM/i)
    expect(SQL).not.toMatch(/UPDATE public\."August_2026"/i)
    expect(SQL).not.toMatch(/ALTER TABLE public\.workspace_member_codes/i)
    expect(SQL).not.toMatch(/ALTER TABLE public\..*members/i)
    expect(SQL).not.toMatch(/paper_scan_save_operations.*drop/i)
  })

  it('adds server-safe normalization helpers (immutable, no external extension)', () => {
    expect(SQL).toMatch(/create or replace function public\.paper_scan_normalize_phone_for_guard\(p_value text\)/)
    expect(SQL).toMatch(/create or replace function public\.paper_scan_normalize_name_for_guard\(p_value text\)/)
    expect(SQL).toMatch(/create or replace function public\.paper_scan_identity_lock_key\(p_owner_id uuid, p_phone text, p_name text\)/)
    expect(SQL).toMatch(/hashtextextended/)
    // No external extension dependency.
    expect(SQL).not.toMatch(/unaccent/i)
    expect(SQL).not.toMatch(/pg_trgm/i)
  })

  it('serializes member creation by normalized identity, not by the new UUID', () => {
    // The identity-scoped lock must run before the fresh candidate query.
    const lockIndex = SQL.indexOf('paper_scan_identity_lock_key(')
    const candidateIndex = SQL.indexOf('blocked_duplicate')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(candidateIndex).toBeGreaterThan(lockIndex)
    expect(SQL).toMatch(/perform pg_advisory_xact_lock\(public\.paper_scan_identity_lock_key/)
  })

  it('runs a fresh candidate query scoped to the authorized workspace and month', () => {
    expect(SQL).toMatch(/workspace_owner_id = \$1/)
    expect(SQL).toMatch(/paper_scan_normalize_phone_for_guard\(%I\) = \$2/)
    expect(SQL).toMatch(/paper_scan_normalize_name_for_guard\(%I\) = \$3/)
    // Only active members are candidates.
    expect(SQL).toMatch(/deleted_at is null/)
  })

  it('returns a structured BLOCKED_DUPLICATE result instead of a generic error', () => {
    expect(SQL).toMatch(/blocked_duplicate/, true)
    expect(SQL).toMatch(/duplicate_candidate/)
    expect(SQL).toMatch(/error_message/)
    // No INSERT occurs on a blocked duplicate.
    const insertIndex = SQL.indexOf('insert into public.%I (id, user_id, workspace_owner_id')
    const blockIndex = SQL.indexOf("return jsonb_build_object(\n            'success', false,\n            'blocked_duplicate', true")
    expect(blockIndex).toBeGreaterThan(-1)
    expect(insertIndex).toBeGreaterThan(blockIndex)
  })

  it('preserves the confirmed-duplicate override escape hatch (operator-resolved distinct person)', () => {
    expect(SQL).toMatch(/duplicate_overrides/)
    expect(SQL).toMatch(/v_row_key = any\(v_override_keys\)/)
  })

  it('does not auto-merge shared family phones (candidate requires phone AND name match)', () => {
    // The candidate query conditions both normalized phone and normalized name.
    const phoneCond = SQL.indexOf('paper_scan_normalize_phone_for_guard(%I) = $2')
    const nameCond = SQL.indexOf('paper_scan_normalize_name_for_guard(%I) = $3')
    expect(phoneCond).toBeGreaterThan(-1)
    expect(nameCond).toBeGreaterThan(-1)
    expect(SQL).not.toMatch(/ensure_workspace_member_code[^;]*where.*phone/i)
  })

  it('preserves the 1700 signature, authorization, and idempotency semantics', () => {
    expect(SQL).toMatch(/create or replace function public\.paper_scan_execute_save_step\(p_operation_id uuid, p_step_id uuid\)/)
    expect(SQL).toMatch(/security definer/)
    expect(SQL).toMatch(/require_permanent_workspace_actor\(o\.owner_id, false\)/)
    expect(SQL).toMatch(/saved_scan_user_id <> v_actor/)
    expect(SQL).toMatch(/if s\.state = 'succeeded' then/)
    expect(SQL).toMatch(/on conflict \(id\) do nothing/)
    expect(SQL).toMatch(/ensure_workspace_member_code\(o\.owner_id, jsonb_build_object\('id', s\.member_id\)\)/)
    expect(SQL).toMatch(/notify pgrst, 'reload schema'/)
  })

  it('keeps grants limited to authenticated and revokes from anon/public', () => {
    expect(SQL).toMatch(/revoke all on function public\.paper_scan_execute_save_step\(uuid, uuid\) from public, anon/)
    expect(SQL).toMatch(/grant execute on function public\.paper_scan_execute_save_step\(uuid, uuid\) to authenticated/)
    expect(SQL).not.toMatch(/TO anon/i)
    expect(SQL).not.toMatch(/service_role/i)
  })
})
