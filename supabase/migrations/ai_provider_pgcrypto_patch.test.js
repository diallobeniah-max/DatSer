// @vitest-environment node
// Static design checks for the AI Provider pgcrypto patch migration.
// The migration is NOT applied here; these tests pin the SQL contract: explicit
// extensions.pgp_sym_encrypt / extensions.pgp_sym_decrypt qualification, the
// stale 4-arg overload is dropped, the 5-arg set_secret and resolve_key are
// redefined, and no unrelated tables are touched.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260815172114_20260815190000_patch_ai_provider_pgcrypto_resolution.sql'), 'utf8')

describe('ai_provider pgcrypto resolution patch migration', () => {
  it('qualifies pgp_sym_encrypt and pgp_sym_decrypt with the extensions schema', () => {
    expect(SQL).toMatch(/extensions\.pgp_sym_encrypt\(/)
    expect(SQL).toMatch(/extensions\.pgp_sym_decrypt\(/)
    // No unqualified calls remain in the redefined functions.
    expect(SQL).not.toMatch(/:= pgp_sym_encrypt\(/)
    expect(SQL).not.toMatch(/:= pgp_sym_decrypt\(/)
  })

  it('drops the stale 4-arg set_secret overload', () => {
    expect(SQL).toMatch(/drop function if exists public\.ai_provider_set_secret\(uuid, text, text, text\)/)
  })

  it('redefines the 5-arg set_secret and resolve_key', () => {
    expect(SQL).toMatch(/create or replace function public\.ai_provider_set_secret\(\s*p_owner_id uuid,\s*p_provider text,\s*p_secret text,\s*p_encryption_key text,\s*p_model text default ''/m)
    expect(SQL).toMatch(/create or replace function public\.ai_provider_resolve_key\(/)
  })

  it('keeps authorization and search_path semantics', () => {
    expect(SQL).toMatch(/SECURITY DEFINER/)
    expect(SQL).toMatch(/require_permanent_workspace_actor\(p_owner_id, true\)/)
    expect(SQL).toMatch(/require_permanent_workspace_actor\(p_owner_id, false\)/)
    // search_path is NOT broadened with extensions.
    expect(SQL).toMatch(/set search_path = pg_catalog, public, pg_temp/)
  })

  it('keeps resolve_key revoked from browser roles', () => {
    expect(SQL).toMatch(/revoke all on function public\.ai_provider_resolve_key\(uuid, text, text\) from public, anon, authenticated/)
  })

  it('does not touch members, attendance, provenance, ownership, or codes', () => {
    expect(SQL).not.toMatch(/ALTER TABLE public\."August_2026"/i)
    expect(SQL).not.toMatch(/workspace_member_codes/i)
    expect(SQL).not.toMatch(/member_provenance/i)
    expect(SQL).not.toMatch(/DELETE FROM/i)
  })

  it('refreshes the schema cache', () => {
    expect(SQL).toMatch(/notify pgrst, 'reload schema'/i)
  })
})
