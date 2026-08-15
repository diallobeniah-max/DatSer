// @vitest-environment node
// Static design checks for the AI Provider routing + model migration.
// The migration is NOT applied here; these tests pin the SQL contract: widened
// provider set (gemini + qwen), per-provider model, simple primary/fallback
// routing, secure SECURITY DEFINER RPCs, and no unrelated changes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260815180000_ai_provider_routing.sql'), 'utf8')

describe('ai_provider_routing migration', () => {
  it('widens the provider set to gemini + qwen and adds a model column', () => {
    expect(SQL).toMatch(/provider in \('gemini', 'qwen'\)/)
    expect(SQL).toMatch(/add column if not exists model text not null default ''/)
  })

  it('creates a simple routing preference table with no client SELECT', () => {
    expect(SQL).toMatch(/create table if not exists public\.ai_provider_routing/)
    expect(SQL).toMatch(/primary_provider text not null/)
    expect(SQL).toMatch(/fallback_provider text/)
    expect(SQL).toMatch(/revoke all on table public\.ai_provider_routing from public, anon, authenticated/)
    expect(SQL).toMatch(/using \(false\) with check \(false\)/)
  })

  it('gates routing operations behind permanent workspace admin authorization', () => {
    expect(SQL).toMatch(/function public\.ai_provider_get_routing\(/)
    expect(SQL).toMatch(/function public\.ai_provider_set_routing\(/)
    expect(SQL).toMatch(/require_permanent_workspace_actor\(p_owner_id, true\)/)
  })

  it('keeps secrets encrypted and status masked (model is returned, secret is not)', () => {
    expect(SQL).toMatch(/pgp_sym_encrypt\(/)
    expect(SQL).toMatch(/pgp_sym_decrypt\(/)
    expect(SQL).toMatch(/masked_suffix/)
    expect(SQL).toMatch(/'model',/)
  })

  it('keeps resolve key server-only and never grants it to browser roles', () => {
    expect(SQL).toMatch(/revoke all on function public\.ai_provider_resolve_key\(uuid, text, text\) from public, anon, authenticated/)
    expect(SQL).toMatch(/require_permanent_workspace_actor\(p_owner_id, false\)/)
  })

  it('does not touch members, attendance, provenance, ownership, or codes', () => {
    expect(SQL).not.toMatch(/ALTER TABLE public\."August_2026"/i)
    expect(SQL).not.toMatch(/workspace_member_codes/i)
    expect(SQL).not.toMatch(/member_provenance/i)
    expect(SQL).not.toMatch(/DROP TABLE/i)
    expect(SQL).not.toMatch(/DELETE FROM/i)
  })

  it('refreshes the schema cache for PostgREST', () => {
    expect(SQL).toMatch(/notify pgrst, 'reload schema'/i)
  })
})
