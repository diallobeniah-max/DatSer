// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260826050000_csv_import_monotonic_sequences.sql'), 'utf8')

describe('CSV Import monotonic Saved Import numbering', () => {
  it('stores the last allocated sequence outside deletable history rows', () => {
    expect(SQL).toMatch(/create table if not exists public\.csv_import_sequence_counters/)
    expect(SQL).toMatch(/owner_id uuid primary key/)
    expect(SQL).toMatch(/last_sequence integer not null check \(last_sequence > 0\)/)
  })

  it('serializes allocation and increments from the greater of the counter or surviving history', () => {
    expect(SQL).toContain("pg_advisory_xact_lock(hashtextextended('csv-import-sequence:' || p_owner_id::text, 0))")
    expect(SQL).toMatch(/greatest\(\s*public\.csv_import_sequence_counters\.last_sequence,[\s\S]*max\(sequence_number\)[\s\S]*\) \+ 1/)
  })

  it('keeps the counter private and the allocator workspace-scoped', () => {
    expect(SQL).toMatch(/enable row level security/)
    expect(SQL).toMatch(/revoke all on table public\.csv_import_sequence_counters from public, anon, authenticated/)
    expect(SQL).toContain('p_user_id is distinct from v_actor')
    expect(SQL).toContain('not public.can_access_workspace(p_owner_id)')
    expect(SQL).toMatch(/revoke all on function public\.create_csv_import_session[^;]+from public, anon/)
  })
})
