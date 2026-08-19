// @vitest-environment node
// Static safety checks for the Paper Scan profile-field persistence migration.
// This migration is additive only and must never be applied automatically here.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260816000000_harden_paper_scan_profile_fields.sql'), 'utf8')

describe('paper_scan profile-field persistence migration', () => {
  it('is additive and never drops tables or mutates unrelated member tables', () => {
    expect(SQL).toMatch(/create or replace function public\.paper_scan_execute_save_step/)
    expect(SQL).not.toMatch(/DROP TABLE/i)
    expect(SQL).not.toMatch(/DELETE FROM/i)
    expect(SQL).not.toMatch(/ALTER TABLE public\./i)
    expect(SQL).not.toMatch(/paper_scan_save_operations.*drop/i)
  })

  it('preserves the durable save signature, authorization, and idempotency', () => {
    expect(SQL).toMatch(/create or replace function public\.paper_scan_execute_save_step\(p_operation_id uuid, p_step_id uuid\)/)
    expect(SQL).toMatch(/security definer/)
    expect(SQL).toMatch(/require_permanent_workspace_actor\(o\.owner_id, false\)/)
    expect(SQL).toMatch(/saved_scan_user_id <> v_actor/)
    expect(SQL).toMatch(/if s\.state = 'succeeded' then/)
    expect(SQL).toMatch(/on conflict \(id\) do nothing/)
    expect(SQL).toMatch(/ensure_workspace_member_code\(o\.owner_id, jsonb_build_object\('id', s\.member_id\)\)/)
  })

  it('persists Age and Parent/Guardian fields for member-create steps when columns exist', () => {
    expect(SQL).toMatch(/month_table_has_column\(v_table, 'Age'\)/)
    expect(SQL).toMatch(/month_table_has_column\(v_table, 'parent_name_1'\)/)
    expect(SQL).toMatch(/month_table_has_column\(v_table, 'parent_phone_1'\)/)
    expect(SQL).toMatch(/coalesce\(s\.member_payload ->> 'Age', s\.member_payload ->> 'age'\)/)
    expect(SQL).toMatch(/s\.member_payload ->> 'parent_name_1'/)
    expect(SQL).toMatch(/s\.member_payload ->> 'parent_phone_1'/)
  })

  it('persists Age and Parent/Guardian fields for existing-member profile updates when columns exist', () => {
    expect(SQL).toMatch(/s\.profile_payload \? 'age' or s\.profile_payload \? 'Age'/)
    expect(SQL).toMatch(/s\.profile_payload \? 'parent_name_1'/)
    expect(SQL).toMatch(/s\.profile_payload \? 'parent_phone_1'/)
    expect(SQL).toMatch(/month_table_has_column\(v_table, 'Age'\)/)
    expect(SQL).toMatch(/month_table_has_column\(v_table, 'parent_name_1'\)/)
    expect(SQL).toMatch(/month_table_has_column\(v_table, 'parent_phone_1'\)/)
  })

  it('never writes a column the trusted month table does not have', () => {
    const profileClauses = SQL.split('elsif s.kind = \'profile\' then')[1]?.split('else')[0] || ''
    expect(profileClauses).toContain('month_table_has_column')
    expect(profileClauses).not.toMatch(/update public\.[^%]* set .*Age.*where id/i)
  })

  it('keeps grants limited to authenticated and revokes from public/anon', () => {
    expect(SQL).toMatch(/revoke all on function public\.paper_scan_execute_save_step\(uuid, uuid\) from public, anon/)
    expect(SQL).toMatch(/grant execute on function public\.paper_scan_execute_save_step\(uuid, uuid\) to authenticated/)
    expect(SQL).not.toMatch(/TO anon/i)
    expect(SQL).not.toMatch(/service_role/i)
  })
})
