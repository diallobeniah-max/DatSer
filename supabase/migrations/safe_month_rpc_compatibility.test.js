// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260814122618_20260813170000_harden_paper_scan_final_save.sql'), 'utf8')

const functionBody = (name) => {
  const replaceStart = SQL.indexOf(`create or replace function public.${name}`)
  const createStart = SQL.indexOf(`create function public.${name}`)
  const start = replaceStart >= 0 ? replaceStart : createStart
  expect(start).toBeGreaterThanOrEqual(0)
  const end = SQL.indexOf('\n$$;', start)
  expect(end).toBeGreaterThan(start)
  return SQL.slice(start, end)
}

describe('safe logical-month RPC compatibility contract', () => {
  it('accepts logical dates and never accepts client-selected physical table names', () => {
    const body = functionBody('set_member_attendance_from_other_month')
    expect(body).toMatch(/p_source_month date, p_target_month date/)
    expect(body).not.toMatch(/p_source_table|p_target_table/)
    expect(body).toContain('workspace_month_table_for(p_owner_id, p_source_month)')
    expect(body).toContain('workspace_month_table_for(p_owner_id, p_target_month)')
  })

  it('requires a permanent authorized workspace actor', () => {
    expect(functionBody('create_workspace_month')).toContain('require_permanent_workspace_actor(p_owner_id, true)')
    expect(functionBody('set_member_attendance_from_other_month')).toContain('require_permanent_workspace_actor(p_owner_id, false)')
  })

  it('requires an explicit Sunday and Present or Absent status in the target month', () => {
    const body = functionBody('set_member_attendance_from_other_month')
    expect(body).toContain("p_attendance_status not in ('Present', 'Absent')")
    expect(body).toContain('extract(isodow from p_attendance_date) <> 7')
    expect(body).toContain("date_trunc('month', p_attendance_date)::date <> p_target_month")
  })

  it('scopes all source and target row access to immutable workspace ownership', () => {
    const body = functionBody('set_member_attendance_from_other_month')
    expect(body).toMatch(/s\.id = \$1 and s\.workspace_owner_id = \$2/)
    expect(body).toMatch(/id=\$1 and workspace_owner_id = \$2/)
    expect(body).toMatch(/id=\$2 and workspace_owner_id = \$3/)
  })

  it('is idempotent and records completion using the live schema column', () => {
    const body = functionBody('set_member_attendance_from_other_month')
    expect(body).toContain('member_mutation_idempotency')
    expect(body).toContain('on conflict (owner_id, table_name, operation_name, request_id) do nothing')
    expect(body).toContain('completed_at = now()')
    expect(body).not.toMatch(/member_mutation_idempotency[^;]*updated_at\s*=\s*now\(\)/s)
  })

  it('quotes derived physical identifiers and never interpolates caller input as identifiers', () => {
    const body = functionBody('set_member_attendance_from_other_month')
    expect(body).toContain("format('select to_jsonb(s.*) from public.%I")
    expect(body).toContain("format('update public.%I set %I=$1")
    expect(body).not.toMatch(/execute\s+['\"][^'\"]*p_(source|target)/i)
  })

  it('revokes anonymous/public access and grants only authenticated callers', () => {
    expect(SQL).toMatch(/revoke all on function public\.set_member_attendance_from_other_month\(uuid, date, date, uuid, date, text, text\) from public, anon/i)
    expect(SQL).toMatch(/grant execute on function public\.set_member_attendance_from_other_month\(uuid, date, date, uuid, date, text, text\) to authenticated/i)
  })
})
