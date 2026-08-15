// @vitest-environment node
// Static design checks for the AI Provider credentials migration.
// The migration is NOT applied here; these tests pin the SQL contract:
// encrypted server-side storage, no client SELECT, admin-gated RPCs, masked
// status, server-only resolve, and no unrelated table changes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260815170000_ai_provider_credentials.sql'), 'utf8')

describe('ai_provider_credentials migration', () => {
  it('creates an encrypted credentials table and denies all client SELECT', () => {
    expect(SQL).toMatch(/create table if not exists public\.ai_provider_credentials/)
    expect(SQL).toMatch(/encrypted_secret text not null/)
    expect(SQL).toMatch(/masked_suffix text not null/)
    expect(SQL).toMatch(/enable row level security/)
    expect(SQL).toMatch(/revoke all on table public\.ai_provider_credentials from public, anon, authenticated/)
    expect(SQL).toMatch(/using \(false\) with check \(false\)/)
  })

  it('never stores or returns a plaintext secret to the browser', () => {
    // Status returns only metadata, never the secret.
    expect(SQL).toMatch(/maskedSuffix/)
    expect(SQL).toMatch(/configured/)
    expect(SQL).toMatch(/lastVerified/)
    // The stored column is always encrypted with pgp_sym_encrypt.
    expect(SQL).toMatch(/pgp_sym_encrypt\(/)
    expect(SQL).toMatch(/pgp_sym_decrypt\(/)
  })

  it('gates every operation behind permanent workspace admin authorization', () => {
    const adminGated = [
      'ai_provider_get_status',
      'ai_provider_set_secret',
      'ai_provider_remove'
    ]
    for (const fn of adminGated) {
      expect(SQL).toMatch(new RegExp(`function public\\.${fn}\\(`))
    }
    // Admin-only operations use require_admin = true.
    const setSection = SQL.slice(SQL.indexOf('ai_provider_set_secret'))
    expect(setSection).toMatch(/require_permanent_workspace_actor\(p_owner_id, true\)/)
  })

  it('keeps the resolve path server-only and never grants it to browser roles', () => {
    expect(SQL).toMatch(/function public\.ai_provider_resolve_key\(/)
    expect(SQL).toMatch(/revoke all on function public\.ai_provider_resolve_key\(uuid, text, text\) from public, anon, authenticated/)
    // Collaborators can power extraction (require_admin=false) but only via the
    // server-side resolve call, never through a browser role grant.
    const resolveSection = SQL.slice(SQL.indexOf('ai_provider_resolve_key'))
    expect(resolveSection).toMatch(/require_permanent_workspace_actor\(p_owner_id, false\)/)
  })

  it('does not touch members, attendance, provenance, ownership, or codes', () => {
    expect(SQL).not.toMatch(/ALTER TABLE public\."August_2026"/i)
    expect(SQL).not.toMatch(/UPDATE public\."August_2026"/i)
    expect(SQL).not.toMatch(/workspace_member_codes/i)
    expect(SQL).not.toMatch(/workspace_owner_id =/i)
    expect(SQL).not.toMatch(/member_provenance/i)
    expect(SQL).not.toMatch(/DROP TABLE/i)
  })

  it('refreshes the schema cache for PostgREST', () => {
    expect(SQL).toMatch(/notify pgrst, 'reload schema'/i)
  })
})
