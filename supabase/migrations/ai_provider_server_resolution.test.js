import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const migration = readFileSync(resolve(repo, 'supabase/migrations/20260815180356_harden_ai_provider_server_resolution.sql'), 'utf8')

describe('AI provider server credential resolution migration', () => {
  it('permits the private service-role resolver without exposing it to browser roles', () => {
    expect(migration).toContain("if auth.role() <> 'service_role' then")
    expect(migration).toContain('perform public.require_permanent_workspace_actor(p_owner_id, false);')
    expect(migration).toContain('revoke all on function public.ai_provider_resolve_key(uuid, text, text) from public, anon, authenticated;')
  })

  it('returns safe explicit states for missing and unreadable stored credentials', () => {
    expect(migration).toContain("'status', 'not_found'")
    expect(migration).toContain("'status', 'unreadable'")
    expect(migration).toContain("'code', 'CREDENTIAL_DECRYPT_FAILED'")
    expect(migration).not.toContain('raise exception when others')
  })
})
