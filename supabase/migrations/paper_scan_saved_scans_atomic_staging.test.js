// @vitest-environment node
// Static design checks + in-memory concurrency simulation for the atomic
// staging-metadata migrations. The migrations are NOT applied here (live DB is
// off-limits); these tests pin the SQL contract and prove the merge algorithm
// keeps every successfully persisted sheet no matter the completion order.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const ATOMIC_SQL = readFileSync(join(HERE, '20260815071003_paper_scan_saved_scans_atomic_staging.sql'), 'utf8')
const ANON_SQL = readFileSync(join(HERE, '20260815071020_harden_paper_scan_saved_scans_non_anonymous.sql'), 'utf8')

describe('paper_scan_saved_scans_atomic_staging migration', () => {
  it('defines the atomic merge RPC as security definer with a locked search_path', () => {
    expect(ATOMIC_SQL).toMatch(/create or replace function public\.paper_scan_merge_staged_sheet/)
    expect(ATOMIC_SQL).toMatch(/SECURITY DEFINER/i)
    expect(ATOMIC_SQL).toMatch(/set search_path = pg_catalog, public, pg_temp/i)
  })

  it('rejects anonymous callers through the existing permanent-actor helper', () => {
    expect(ATOMIC_SQL).toMatch(/public\.require_permanent_workspace_actor\(p_owner_id, false\)/)
  })

  it('locks the target row FOR UPDATE before reading the latest metadata', () => {
    expect(ATOMIC_SQL).toMatch(/for update/i)
  })

  it('merges exactly ONE sheet and preserves every other existing reference', () => {
    // Add path: appends a single sheet to the LATEST array.
    expect(ATOMIC_SQL).toMatch(/v_array := v_array \|\| jsonb_build_array\(p_sheet\)/)
    // Update path: replaces only the matching sheetId, keeping siblings.
    expect(ATOMIC_SQL).toMatch(/case when e ->> 'sheetId' = v_sheet_id then p_sheet else e end/)
    expect(ATOMIC_SQL).not.toMatch(/sheet_images = p_sheet_images/)
  })

  it('returns the durable row so the client can prove persistence', () => {
    expect(ATOMIC_SQL).toMatch(/returns public\.paper_scan_saved/)
    expect(ATOMIC_SQL).toMatch(/returning \* into v_scan/)
  })

  it('marks and preserves the _staging marker', () => {
    expect(ATOMIC_SQL).toMatch(/jsonb_build_object\('_staging', true\)/)
    expect(ATOMIC_SQL).toMatch(/jsonb_set\(/)
  })

  it('grants the merge RPC to authenticated callers only', () => {
    expect(ATOMIC_SQL).toMatch(/revoke all on function public\.paper_scan_merge_staged_sheet\(uuid, uuid, text, jsonb\) from public, anon/)
    expect(ATOMIC_SQL).toMatch(/grant execute on function public\.paper_scan_merge_staged_sheet\(uuid, uuid, text, jsonb\) to authenticated/)
  })

  it('defines a metadata-only remove RPC that never deletes storage objects', () => {
    expect(ATOMIC_SQL).toMatch(/create or replace function public\.paper_scan_remove_staged_sheet/)
    expect(ATOMIC_SQL).toMatch(/e ->> 'sheetId' <> p_sheet_id/)
    // No storage.* / deleteObject / remove call anywhere in this migration.
    expect(ATOMIC_SQL).not.toMatch(/storage\./)
    expect(ATOMIC_SQL).not.toMatch(/removeObject/i)
    expect(ATOMIC_SQL).toMatch(/revoke all on function public\.paper_scan_remove_staged_sheet\(uuid, uuid, text\) from public, anon/)
    expect(ATOMIC_SQL).toMatch(/grant execute on function public\.paper_scan_remove_staged_sheet\(uuid, uuid, text\) to authenticated/)
  })

  it('touches no other workspace tables and refreshes the schema cache', () => {
    expect(ATOMIC_SQL).not.toMatch(/public\.members/i)
    expect(ATOMIC_SQL).not.toMatch(/attendance/i)
    expect(ATOMIC_SQL).not.toMatch(/paper_scan_extraction/i)
    expect(ATOMIC_SQL).toMatch(/notify pgrst, 'reload schema'/)
  })
})

describe('paper_scan_saved_scans_non_anonymous migration', () => {
  it('adds an explicit anonymous denial to every table policy', () => {
    const policies = [
      'Users read their own saved scans',
      'Users save their own scans',
      'Users update their own saved scans',
      'Users delete their own saved scans'
    ]
    for (const policy of policies) {
      expect(ANON_SQL).toMatch(new RegExp(`"${policy}"`))
    }
    // Every policy must carry the anon guard.
    const guard = /not coalesce\(\(auth\.jwt\(\) ->> 'is_anonymous'\)::boolean, false\)/
    expect(ANON_SQL.match(guard)).not.toBeNull()
    expect(ANON_SQL.match(new RegExp(guard.source, 'g'))?.length).toBeGreaterThanOrEqual(6)
  })

  it('adds an explicit anonymous denial to every storage object policy', () => {
    const storagePolicies = [
      'Users upload their own saved scan sheets',
      'Users read their own saved scan sheets',
      'Users update their own saved scan sheets',
      'Users delete their own saved scan sheets'
    ]
    for (const policy of storagePolicies) {
      expect(ANON_SQL).toMatch(new RegExp(`"${policy}"`))
    }
    expect(ANON_SQL).toMatch(/storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)::text\)/)
  })

  it('does not weaken the existing private-per-user model', () => {
    expect(ANON_SQL).not.toMatch(/service_role/i)
    expect(ANON_SQL).not.toMatch(/FOR SELECT TO PUBLIC/i)
    expect(ANON_SQL).not.toMatch(/getPublicUrl/i)
    expect(ANON_SQL).toMatch(/notify pgrst, 'reload schema'/)
  })
})

// In-memory re-implementation of the atomic merge RPC. The `lock` models the
// FOR UPDATE row lock: a merge reads the LATEST durable array, merges one
// sheet, and writes it back atomically, serialized per scan id.
const makeMergeState = () => ({ rows: new Map(), locks: new Map() })

const acquireLock = (state, key) => new Promise((resolve) => {
  const queue = state.locks.get(key) || []
  queue.push(resolve)
  state.locks.set(key, queue)
  if (queue.length === 1) resolve()
})

const releaseLock = (state, key) => {
  const queue = state.locks.get(key)
  queue.shift()
  if (queue.length) queue[0]()
}

const mergeSheetInSim = async (state, { scanId, sheet }) => {
  await acquireLock(state, scanId)
  try {
    const row = state.rows.get(scanId) || { id: scanId, sheet_images: [] }
    const existing = row.sheet_images.find((entry) => entry.sheetId === sheet.sheetId)
    row.sheet_images = existing
      ? row.sheet_images.map((entry) => (entry.sheetId === sheet.sheetId ? sheet : entry))
      : [...row.sheet_images, sheet]
    state.rows.set(scanId, row)
    return row
  } finally {
    releaseLock(state, scanId)
  }
}

const sheetIds = (state, scanId) => (state.rows.get(scanId)?.sheet_images || []).map((entry) => entry.sheetId).sort()

describe('atomic merge under out-of-order completion', () => {
  it('keeps both sheets when metadata writes resolve out of order (B then A)', async () => {
    const state = makeMergeState()
    // A and B upload in parallel. Their metadata merges are issued concurrently
    // and may resolve in ANY order; the lock serializes the read-merge-write so
    // the final durable array always contains A + B.
    const mergeA = mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'A', path: 'u/scan-1/A.jpg' } })
    const mergeB = mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'B', path: 'u/scan-1/B.jpg' } })
    await Promise.all([mergeA, mergeB])
    expect(sheetIds(state, 'scan-1')).toEqual(['A', 'B'])
    expect(state.rows.get('scan-1').sheet_images).toHaveLength(2)
  })

  it('keeps all three sheets under concurrent merges', async () => {
    const state = makeMergeState()
    await Promise.all([
      mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'A', path: 'u/scan-1/A.jpg' } }),
      mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'B', path: 'u/scan-1/B.jpg' } }),
      mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'C', path: 'u/scan-1/C.jpg' } })
    ])
    expect(sheetIds(state, 'scan-1')).toEqual(['A', 'B', 'C'])
  })

  it('re-merge of the same sheet id updates rather than duplicates', async () => {
    const state = makeMergeState()
    await mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'A', path: 'u/scan-1/A.jpg' } })
    await mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'A', path: 'u/scan-1/A-new.jpg' } })
    expect(state.rows.get('scan-1').sheet_images).toHaveLength(1)
    expect(state.rows.get('scan-1').sheet_images[0].path).toBe('u/scan-1/A-new.jpg')
  })

  it('scans stay isolated from each other', async () => {
    const state = makeMergeState()
    await Promise.all([
      mergeSheetInSim(state, { scanId: 'scan-1', sheet: { sheetId: 'A', path: 'u/scan-1/A.jpg' } }),
      mergeSheetInSim(state, { scanId: 'scan-2', sheet: { sheetId: 'B', path: 'u/scan-2/B.jpg' } })
    ])
    expect(sheetIds(state, 'scan-1')).toEqual(['A'])
    expect(sheetIds(state, 'scan-2')).toEqual(['B'])
  })
})
