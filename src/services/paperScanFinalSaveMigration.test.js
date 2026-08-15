// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations')
const sql = fs.readFileSync(path.join(migrations, '20260813170000_harden_paper_scan_final_save.sql'), 'utf8')
const protectedSql = fs.readFileSync(path.join(migrations, '20260811220000_update_member_profile_all_months.sql'), 'utf8')

const functionBody = (name) => {
  const start = sql.indexOf(`function public.${name}`)
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('$$;', start) + 3)
}

describe('paper scan final-save security architecture migration', () => {
  it('keeps the protected profile migration separate', () => {
    expect(protectedSql).toContain('authorize_workspace_actor')
    expect(sql).not.toContain('20260811220000_update_member_profile_all_months.sql')
  })

  it('uses a server-owned logical registry and a migration-only reconciliation path', () => {
    expect(sql).toContain('create table if not exists public.workspace_month_tables')
    expect(sql).toContain('select public.reconcile_workspace_month_registry();')
    expect(functionBody('reconcile_workspace_month_registry')).toContain("c.relname ~ '^[A-Z][a-z]+_[0-9]{4}$'")
    expect(sql).toContain('revoke all on function public.reconcile_workspace_month_registry() from public, anon, authenticated;')
    expect(sql).not.toMatch(/grant execute on function public\.reconcile_workspace_month_registry\(\) to authenticated/i)
    expect(sql).not.toMatch(/from public\.user_month_tables[\s\S]{0,180}(authorized|workspace)/i)
    expect(functionBody('reconcile_workspace_month_registry')).toContain('perform public.reconcile_month_member_workspace_provenance(r.table_name);')
    expect(functionBody('reconcile_month_member_workspace_provenance')).toContain('from public.workspace_member_codes')
    expect(functionBody('reconcile_month_member_workspace_provenance')).toContain('having count(distinct workspace_owner_id) = 1')
    expect(functionBody('reconcile_month_member_workspace_provenance')).not.toContain('select distinct user_id')
  })

  it('uses immutable row workspace provenance, never collaborator identity, for every privileged member lookup', () => {
    expect(sql).toContain('add column if not exists workspace_owner_id uuid references auth.users(id)')
    expect(sql).toContain('workspace_owner_id is immutable')
    expect(sql).toContain('workspace_owner_id is required for new month-table rows')
    expect(sql).toContain('workspace_owner_id = $1')
    expect(sql).not.toContain('public.workspace_member_user_in_owner($')
    expect(sql).not.toContain('collaborator_user_id = p_member_user_id')
  })

  it('rejects anonymous JWTs and inactive workspace actors before privileged work', () => {
    const actor = functionBody('require_permanent_workspace_actor')
    expect(actor).toContain("coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)")
    expect(actor).toContain("c.status in ('accepted', 'active')")
  })

  it('keeps legacy raw mutation endpoints closed while preserving a logical cross-month replacement', () => {
    for (const name of ['insert_selected_members', 'reset_month_members', 'add_attendance_column', 'create_month_from_current']) {
      expect(sql).toContain(`revoke all on function public.${name}`)
    }
    expect(sql).toContain('drop function if exists public.set_member_attendance_from_other_month(uuid, text, text, uuid, date, text, text);')
    const crossMonth = functionBody('set_member_attendance_from_other_month')
    expect(crossMonth).toContain('p_source_month date, p_target_month date')
    expect(crossMonth).toContain('public.workspace_month_table_for(p_owner_id, p_source_month)')
    expect(crossMonth).toContain('public.ensure_workspace_attendance_column(p_owner_id, p_target_month, p_attendance_date)')
    expect(crossMonth).not.toContain('p_source_table text')
    expect(crossMonth).not.toContain('p_target_table text')
    expect(crossMonth).toContain('s.workspace_owner_id = $2')
    expect(crossMonth).toContain('workspace_owner_id = $3')
  })

  it('binds operations to a caller-owned private Saved Scan and makes direct reads private', () => {
    const begin = functionBody('paper_scan_begin_save_operation')
    const get = functionBody('paper_scan_get_save_operation')
    expect(begin).toContain('public.require_private_saved_scan(p_saved_scan_id, p_owner_id)')
    expect(begin).toContain('saved_scan_user_id')
    expect(get).toContain('saved_scan_user_id = v_scan.user_id')
    expect(sql).toContain('auth.uid() = saved_scan_user_id and public.has_permanent_workspace_access(owner_id)')
  })

  it('cannot record foreign-operation failure state after authorization fails', () => {
    const execute = functionBody('paper_scan_execute_save_step')
    const handler = execute.indexOf('exception when others then')
    expect(handler).toBeGreaterThan(0)
    expect(execute.indexOf("raise exception 'A permanent authenticated user is required'")).toBeLessThan(handler)
    expect(execute.indexOf('perform public.require_permanent_workspace_actor(o.owner_id, false);')).toBeLessThan(handler)
    expect(execute.indexOf('if o.saved_scan_user_id <> v_actor then')).toBeLessThan(handler)
    expect(execute.indexOf('select * into s from public.paper_scan_save_steps')).toBeLessThan(handler)
    expect(execute.slice(handler)).toContain('if v_authorized then')
    expect(execute.slice(handler)).toContain('where id = s.id and operation_id = o.id')
  })

  it('freezes exact target_months before steps and never re-expands the mutable registry', () => {
    const begin = functionBody('paper_scan_begin_save_operation')
    expect(begin).toContain("jsonb_typeof(v_row -> 'target_months') <> 'array'")
    expect(begin).toContain("jsonb_array_elements(v_row -> 'target_months')")
    expect(begin).toContain("'Frozen target month is invalid'")
    expect(begin).toContain('Do not query the mutable registry here')
    expect(begin).not.toMatch(/select month_start from public\.workspace_month_tables[\s\S]{0,140}all-year/i)
  })

  it('persists stable member ids and durable per-step recovery checkpoints before execution', () => {
    const begin = functionBody('paper_scan_begin_save_operation')
    const execute = functionBody('paper_scan_execute_save_step')
    expect(sql).toContain('immutable_plan jsonb not null')
    expect(sql).toContain('create table if not exists public.paper_scan_save_steps')
    expect(begin).toContain("jsonb_set(v_plan, array['rows', (v_index - 1)::text, 'member_id']")
    expect(begin).toContain("v_index || ':profile'")
    expect(execute).toContain("if s.state = 'succeeded' then")
    expect(execute).toContain("result = jsonb_build_object('success', true")
  })

  it('supports historic tables with or without deleted_at without weakening modern tombstones', () => {
    const execute = functionBody('paper_scan_execute_save_step')
    expect(execute).toContain("public.month_table_has_column(v_table, 'deleted_at')")
    expect(execute).toContain("case when v_has_deleted then ' and deleted_at is null' else '' end")
    const crossMonth = functionBody('set_member_attendance_from_other_month')
    expect(crossMonth).toContain("public.month_table_has_column(v_source, 'deleted_at')")
    expect(crossMonth).toContain("public.month_table_has_column(v_target, 'deleted_at')")
  })

  it('keeps the dual-collaborator A/B boundary independent of the editing actor', () => {
    const createMonth = functionBody('create_workspace_month')
    const execute = functionBody('paper_scan_execute_save_step')
    const crossMonth = functionBody('set_member_attendance_from_other_month')
    expect(createMonth).toContain("v_copy_filter := 'workspace_owner_id = $1'")
    expect(execute).toContain('where id=$5 and workspace_owner_id = $6')
    expect(execute).toContain('where id=$2 and workspace_owner_id = $3')
    expect(crossMonth).toContain('where s.id = $1 and s.workspace_owner_id = $2')
    expect(crossMonth).not.toContain('collaborator_user_id')
  })

  it('keeps New Month logical, authorized, and atomically registered', () => {
    const createMonth = functionBody('create_workspace_month')
    expect(createMonth).toContain('p_year integer, p_month integer, p_source_month date')
    expect(createMonth).toContain("v_target := to_char(v_target_month, 'FMMonth_YYYY')")
    expect(createMonth).toContain('public.ensure_workspace_month_registration(p_owner_id, p_source_month)')
    expect(createMonth).toContain('insert into public.workspace_month_tables(owner_id, month_start, table_name, created_by)')
    expect(createMonth).not.toContain('p_target_table')
  })

  it('uses PostgreSQL-compatible UUID aggregation in provenance reconciliation without bare min(uuid)', () => {
    const reconcile = functionBody('reconcile_month_member_workspace_provenance')
    expect(reconcile).toContain('min(workspace_owner_id::text)::uuid')
    expect(reconcile).toContain('min(code.workspace_owner_id::text)::uuid')
    expect(reconcile).toContain('having count(distinct workspace_owner_id) = 1')
    expect(sql).not.toMatch(/min\(\s*workspace_owner_id\s*\)/)
    expect(sql).not.toMatch(/min\(\s*code\.workspace_owner_id\s*\)/)
  })

  it('supports empty New Month with NULL source month while requiring source for copy modes', () => {
    const createMonth = functionBody('create_workspace_month')
    expect(createMonth).toContain("if p_copy_mode <> 'empty' then")
    expect(createMonth).toContain("if p_source_month is null or p_source_month <> date_trunc('month', p_source_month)::date then")
    expect(createMonth).toContain("raise exception 'A source logical month is required'")
    expect(createMonth).toContain('if p_source_month is not null then')
    expect(createMonth).toContain('v_source := public.ensure_workspace_month_registration(p_owner_id, p_source_month);')
  })

  it('protects member-create against foreign and unowned UUID collisions before code allocation', () => {
    const execute = functionBody('paper_scan_execute_save_step')
    expect(execute).toContain('from public.workspace_member_provenance_exclusions where member_id = s.member_id')
    expect(execute).toContain('from public.workspace_member_codes where member_id = s.member_id and workspace_owner_id <> o.owner_id')
    expect(execute).toContain('if v_existing_owner is null or v_existing_owner <> o.owner_id')
    expect(execute).toContain('perform public.ensure_workspace_member_code(o.owner_id, jsonb_build_object(\'id\', s.member_id));')
  })

  it('acquires all distinct member advisory locks in deterministic order before acquiring the workspace sequential lock once', () => {
    const execute = functionBody('paper_scan_execute_save_step')
    const allocator = functionBody('ensure_workspace_member_codes')
    expect(execute).toContain('perform pg_advisory_xact_lock(hashtextextended(s.member_id::text, 0));')
    expect(allocator).toContain('for v_lock_id in')
    expect(allocator).toContain("select distinct nullif(value ->> 'id', '')::uuid as member_id")
    expect(allocator).toContain('order by member_id')
    expect(allocator).toContain('perform pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 0));')

    // Check that member lock loop appears BEFORE the workspace lock
    const memberLockPos = allocator.indexOf('perform pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 0));')
    const wsLockPos = allocator.indexOf("perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));")
    expect(memberLockPos).toBeGreaterThan(0)
    expect(wsLockPos).toBeGreaterThan(memberLockPos)

    // Ensure workspace lock is NOT inside the member allocation loop
    const allocLoopPos = allocator.indexOf('for v_member in')
    expect(allocLoopPos).toBeGreaterThan(wsLockPos)
    const afterAllocLoop = allocator.slice(allocLoopPos)
    expect(afterAllocLoop).not.toContain("perform pg_advisory_xact_lock(hashtextextended('workspace_member_codes:' || p_owner_id::text, 0));")
  })

  it('hardens the generic member-code allocator to prove server workspace ownership and reject foreign/excluded UUIDs', () => {
    const allocator = functionBody('ensure_workspace_member_codes')
    const belongs = functionBody('member_belongs_to_workspace')
    expect(allocator).toContain('from public.workspace_member_provenance_exclusions where member_id = v_member.member_id')
    expect(allocator).toMatch(/from public\.workspace_member_codes\s+where member_id = v_member\.member_id and workspace_owner_id <> p_owner_id/)
    expect(allocator).toContain('if not public.member_belongs_to_workspace(p_owner_id, v_member.member_id) then')
    expect(allocator).toContain("raise exception 'Member id % does not belong to authorized workspace %'")
    expect(belongs).toMatch(/from public\.workspace_member_codes\s+where workspace_owner_id = p_owner_id and member_id = p_member_id/)
    expect(belongs).toContain('from public.workspace_member_provenance_overrides')
    expect(belongs).toMatch(/from public\.workspace_month_tables\s+where owner_id = p_owner_id/)
    expect(sql).toContain('revoke all on function public.member_belongs_to_workspace(uuid, uuid) from public, anon, authenticated;')
  })

  it('properly casts created_by as null::uuid in month registry reconciliation', () => {
    const reconcile = functionBody('reconcile_workspace_month_registry')
    expect(reconcile).toContain('select distinct workspace_owner_id, $1, $2, null::uuid')
  })

  it('binds positional parameters $1..$6 consistently for profile updates regardless of which fields are present', () => {
    const execute = functionBody('paper_scan_execute_save_step')
    expect(execute).toContain("if s.profile_payload ? 'full_name' or s.profile_payload ? 'Full Name' then")
    expect(execute).toContain("v_sql := v_sql || format('%I = $1, ', 'Full Name');")
    expect(execute).toContain("v_sql := v_sql || format('%I = %I, ', 'Full Name', 'Full Name');")
    expect(execute).toContain('where id=$5 and workspace_owner_id = $6')
    expect(execute).toContain("coalesce(s.profile_payload ->> 'Full Name', s.profile_payload ->> 'full_name')")
    expect(execute).toContain("coalesce(s.profile_payload ->> 'Phone Number', s.profile_payload ->> 'phone_number')")
    expect(execute).toContain("coalesce(s.profile_payload ->> 'Gender', s.profile_payload ->> 'gender')")
    expect(execute).toContain("coalesce(s.profile_payload ->> 'Current Level', s.profile_payload ->> 'current_level')")
  })
})
