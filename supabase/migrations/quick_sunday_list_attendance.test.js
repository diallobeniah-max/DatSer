// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('./20260818110000_add_quick_sunday_list_attendance.sql', import.meta.url), 'utf8')

describe('Quick Sunday List narrow attendance RPC migration', () => {
  it('is authenticated, logical-month scoped, idempotent, and existing-member only', () => {
    expect(sql).toMatch(/require_permanent_workspace_actor\(p_owner_id, false\)/)
    expect(sql).toMatch(/workspace_month_table_for\(p_owner_id, p_month_start\)/)
    expect(sql).toMatch(/ensure_workspace_attendance_column\(p_owner_id, p_month_start, p_attendance_date\)/)
    expect(sql).toMatch(/extract\(isodow from p_attendance_date\) <> 7/)
    expect(sql).toMatch(/member_mutation_idempotency/)
    expect(sql).toMatch(/workspace_owner_id=\$2/)
    expect(sql).not.toMatch(/ensure_workspace_member_code|insert into public\.%I|source_month/i)
    expect(sql).toMatch(/revoke all on function public\.set_workspace_month_member_attendance.*from public, anon/i)
  })
})
