// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATION_PATH = join(HERE, '20260813180000_add_safe_month_rpc_compatibility.sql')
const HARDEN_MIGRATION_PATH = join(HERE, '20260813170000_harden_paper_scan_final_save.sql')
const PROTECTED_MIGRATION_PATH = join(HERE, '20260811220000_update_member_profile_all_months.sql')

const SQL = readFileSync(MIGRATION_PATH, 'utf8')

describe('safe month RPC compatibility migration - hardened security & behavioral contracts', () => {
  it('1. eliminates user_id ownership fallback: immutable workspace_owner_id is used exclusively', () => {
    // Prohibit OR user_id = owner pattern
    expect(SQL).not.toMatch(/workspace_owner_id\s*=\s*p_owner_id\s+or\s+user_id\s*=\s*p_owner_id/i)
    expect(SQL).not.toMatch(/workspace_owner_id\s*=\s*[^;\n]+\s+or\s+user_id\s*=\s*/i)
    expect(SQL).not.toMatch(/coalesce\s*\(\s*workspace_owner_id\s*,\s*user_id\s*\)/i)

    // Ensure all row lookups and copies enforce workspace_owner_id = p_owner_id
    expect(SQL).toMatch(/s\.workspace_owner_id = %L/i)
    expect(SQL).toMatch(/t\.workspace_owner_id = \$2/i)
    expect(SQL).toMatch(/where id = \$2 and workspace_owner_id = \$3/i)
  })

  it('2. explicitly rejects anonymous auth users in both RPCs', () => {
    // Both RPCs must inspect auth.jwt() ->> 'is_anonymous' and role = 'anon'
    const anonChecks = SQL.match(/auth\.jwt\(\)\s*->>\s*'is_anonymous'/g)
    expect(anonChecks).not.toBeNull()
    expect(anonChecks.length).toBeGreaterThanOrEqual(2)

    const anonRoleChecks = SQL.match(/auth\.jwt\(\)\s*->>\s*'role'\s*=\s*'anon'/g)
    expect(anonRoleChecks).not.toBeNull()
    expect(anonRoleChecks.length).toBeGreaterThanOrEqual(2)

    // Ensure permissions are revoked from public and anon
    expect(SQL).toMatch(/revoke all on function public\.create_workspace_month\(.*\) from public, anon/i)
    expect(SQL).toMatch(/grant execute on function public\.create_workspace_month\(.*\) to authenticated/i)
    expect(SQL).toMatch(/revoke all on function public\.set_member_attendance_from_logical_month\(.*\) from public, anon/i)
    expect(SQL).toMatch(/grant execute on function public\.set_member_attendance_from_logical_month\(.*\) to authenticated/i)
  })

  it('3. client cannot nominate arbitrary physical tables (all table names derived server-side with strict validation)', () => {
    expect(SQL).not.toMatch(/create or replace function public\.create_workspace_month\([^)]*p_target_table/i)
    expect(SQL).not.toMatch(/create or replace function public\.create_workspace_month\([^)]*p_source_table/i)
    expect(SQL).not.toMatch(/create or replace function public\.set_member_attendance_from_logical_month\([^)]*p_target_table/i)
    expect(SQL).not.toMatch(/create or replace function public\.set_member_attendance_from_logical_month\([^)]*p_source_table/i)

    // Table names derived strictly via to_char(date, 'FMMonth_YYYY')
    expect(SQL).toMatch(/v_target := to_char\(v_target_month, 'FMMonth_YYYY'\)/)
    expect(SQL).toMatch(/v_source := to_char\(p_source_month, 'FMMonth_YYYY'\)/)
    expect(SQL).toMatch(/\^\[A-Z\]\[a-z\]\+_\[0-9\]\{4\}\$/)
  })

  it('4. rejects unregistered/untrusted workspace-month relations (requires source table to exist and have workspace_owner_id)', () => {
    expect(SQL).toMatch(/if not v_source_has_owner then/i)
    expect(SQL).toMatch(/Source table lacks immutable workspace_owner_id/i)
    expect(SQL).toMatch(/Active member % is not present in source month % for this workspace/i)
  })

  it('5. valid authorized workspace actor check is required on entry', () => {
    const authCalls = SQL.match(/public\.(require_permanent_workspace_actor|authorize_workspace_actor)\(p_owner_id/g)
    expect(authCalls).not.toBeNull()
    expect(authCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('6. copy-forward resets attendance (copies only non-attendance profile attributes, leaving Sunday columns NULL)', () => {
    // Ensures column filter excludes attendance_%
    expect(SQL).toMatch(/c\.column_name not like 'attendance_%'/i)
    expect(SQL).toMatch(/c\.column_name not in \('id', 'user_id', 'workspace_owner_id', 'inserted_at', 'updated_at', 'deleted_at'\)/i)
    // Ensures Sunday columns are created for the target month
    expect(SQL).toMatch(/'attendance_' \|\| replace\(/)
    // Ensures SELECT * is not blindly used for cross-month copy
    expect(SQL).not.toMatch(/insert into public\.\%I select \* from public\.\%I/i)
  })

  it('7. initial / empty month creation is supported when p_source_month is null', () => {
    expect(SQL).toMatch(/p_source_month date default null/i)
    expect(SQL).toMatch(/p_copy_mode text default 'empty'/i)
    // Table created with default schema when no source table exists
    expect(SQL).toMatch(/create table public\.\%I \(\s*id uuid default gen_random_uuid\(\) primary key/i)
  })

  it('8. existing target month is not destructively overwritten', () => {
    expect(SQL).not.toMatch(/drop table/i)
    expect(SQL).not.toMatch(/delete from public\.\%I/i)
    expect(SQL).not.toMatch(/truncate/i)
    expect(SQL).toMatch(/Month % already exists for this workspace/i)
  })

  it('9. cross-month RPC uses completed_at matching actual live schema (never updated_at on idempotency table)', () => {
    expect(SQL).toMatch(/completed_at = now\(\)/i)
    expect(SQL).not.toMatch(/update public\.member_mutation_idempotency[^;]*updated_at\s*=\s*now\(\)/i)
  })

  it('10. cross-month RPC supports clearing attendance to NULL as well as Present/Absent marks', () => {
    expect(SQL).toMatch(/v_clean_status = '' or lower\(v_clean_status\) in \('clear', 'null'\)/i)
    expect(SQL).toMatch(/v_norm_status := null/i)
    expect(SQL).toMatch(/v_norm_status := 'Present'/i)
    expect(SQL).toMatch(/v_norm_status := 'Absent'/i)
  })

  it('11. cross-workspace writes and reads are completely blocked', () => {
    expect(SQL).toMatch(/s\.workspace_owner_id = %L/i)
    expect(SQL).toMatch(/t\.workspace_owner_id = \$2/i)
    expect(SQL).toMatch(/update public\.\%I set \%I = \$1\%s\%s where id = \$2 and workspace_owner_id = \$3/i)
  })

  it('12. all SQL identifiers are server-quoted via format %I', () => {
    const rawInterpolation = SQL.match(/execute\s+['"][^'"]*\$[0-9a-zA-Z_]+/g)
    expect(rawInterpolation).toBeNull()
  })

  it('13. legacy RPCs remain untouched for live deployed client backward compatibility', () => {
    expect(SQL).not.toMatch(/drop function.*create_month_from_current/i)
    expect(SQL).not.toMatch(/drop function.*set_member_attendance_from_other_month/i)
  })

  it('14. independent from unapplied Paper Scan hardening and historic provenance cutover', () => {
    expect(SQL).not.toMatch(/paper_scan_saved/i)
    expect(SQL).not.toMatch(/paper_scan_final_save/i)
    expect(SQL).not.toMatch(/operator_user_id/i)
    expect(SQL).not.toMatch(/provenance_cutover/i)
    expect(SQL).not.toMatch(/workspace_month_tables/i)
  })

  it('15. protected migration and paper scan hardening migration remain untouched', () => {
    expect(existsSync(HARDEN_MIGRATION_PATH)).toBe(true)
    expect(existsSync(PROTECTED_MIGRATION_PATH)).toBe(true)
    const protectedContent = readFileSync(PROTECTED_MIGRATION_PATH, 'utf8')
    expect(protectedContent).toContain('update_member_profile_all_months')
  })
})
