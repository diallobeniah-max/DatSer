// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260813170000_harden_paper_scan_final_save.sql'), 'utf8')
const appContext = fs.readFileSync(path.join(root, 'src/context/AppContext.jsx'), 'utf8')
const memberModal = fs.readFileSync(path.join(root, 'src/components/MemberModal.jsx'), 'utf8')

const body = (name) => {
  const start = migration.lastIndexOf(`create or replace function public.${name}(`)
  expect(start, `${name} must be redefined by the hardening migration`).toBeGreaterThanOrEqual(0)
  return migration.slice(start, migration.indexOf('$$;', start) + 3)
}

describe('legacy member write and month-table RLS hardening', () => {
  it('uses only immutable workspace_owner_id for member target resolution and verified updates', () => {
    const resolve = body('resolve_member_update_target')
    const update = body('update_member_record')
    const resilient = body('update_member_record_resilient')
    expect(resolve).toContain('public.workspace_month_table_for(p_owner_id, v_month_start)')
    expect(resolve).toContain('workspace_owner_id = $2')
    expect(resolve).not.toContain('collaborator_user_id')
    expect(resolve).not.toContain('user_id =')
    expect(update).toContain('workspace_owner_id = $2')
    expect(resilient).toContain('workspace_owner_id=$2')
  })

  it('hardens soft deletion and closes its obsolete raw-table signature', () => {
    const softDelete = body('soft_delete_member')
    expect(softDelete).toContain('public.resolve_member_update_target')
    expect(softDelete).toContain('workspace_owner_id=$2')
    expect(migration).toContain('revoke all on function public.soft_delete_member(text, uuid) from public, anon, authenticated;')
    expect(migration).toContain('grant execute on function public.soft_delete_member(text, uuid, uuid) to authenticated;')
  })

  it('replaces every canonical month table policy with the permanent workspace provenance policy', () => {
    const rls = body('harden_month_workspace_rls')
    expect(rls).toContain('drop policy if exists')
    expect(rls).toContain('public.is_permanent_workspace_actor(workspace_owner_id)')
    expect(rls).toContain('public.is_permanent_workspace_actor(workspace_owner_id)')
    expect(body('is_permanent_workspace_actor')).toContain("c.status in ('accepted', 'active')")
    expect(body('is_permanent_workspace_actor')).toContain("auth.jwt() ->> 'is_anonymous'")
    expect(migration).toContain('perform public.harden_month_workspace_rls(r.table_name);')
  })

  it('keeps direct client reads and new-member creation aligned with immutable workspace provenance', () => {
    expect(appContext).toContain("return query.eq('workspace_owner_id', ownerId)")
    expect(memberModal).toContain("supabase.rpc('save_member_bundle_resilient'")
    expect(memberModal).toContain('workspace_owner_id: ownerId')
  })

  it('does not leave raw bundle/profile/delete helpers browser-callable', () => {
    for (const signature of [
      'update_member_bundle(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb)',
      'save_member_bundle(text, uuid, text, jsonb, text[], uuid[], jsonb)',
      'update_member_profile_all_months(uuid, uuid, text, jsonb)',
      'delete_member_by_id(text, uuid)',
      'set_month_owner_user(text, uuid)'
    ]) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`)
    }
    expect(migration).toContain('revoke all on function public.resolve_member_update_target(text, uuid, uuid, jsonb) from public, anon, authenticated;')
    expect(migration).toContain('grant execute on function public.update_member_record(text, uuid, jsonb, uuid) to authenticated;')
  })
})
