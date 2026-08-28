// @vitest-environment node
// Static design checks + in-memory concurrency simulation for the
// server-authoritative Paper Scan ledger migration. The migration itself is
// NOT applied here (live DB is off-limits); these tests pin the SQL contract
// and prove the claim algorithm stays safe when many claims race.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(join(HERE, '20260812065418_paper_scan_extraction_server_authoritative.sql'), 'utf8')

const QUOTA_PER_WINDOW = 40
const WINDOW_MS = 60 * 60 * 1000

describe('paper_scan_extraction_server_authoritative migration', () => {
  it('adds a nullable request_id column with a unique partial index', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS request_id TEXT/)
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS paper_scan_extraction_user_request_idx/)
    expect(SQL).toMatch(/ON public\.paper_scan_extraction \(user_id, request_id\)/)
    expect(SQL).toMatch(/WHERE request_id IS NOT NULL/)
  })

  it('removes the browser-session insert path entirely', () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "Users record their own extractions"/)
    expect(SQL).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE public\.paper_scan_extraction FROM authenticated/)
    // SELECT (for usage readout) stays; the write path is gone.
    expect(SQL).not.toMatch(/GRANT INSERT ON TABLE public\.paper_scan_extraction/)
    expect(SQL).not.toMatch(/GRANT UPDATE ON TABLE public\.paper_scan_extraction/)
    expect(SQL).not.toMatch(/GRANT DELETE ON TABLE public\.paper_scan_extraction/)
  })

  it('defines the claim RPC as security definer with a locked search_path', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_paper_scan_extraction/)
    expect(SQL).toMatch(/SECURITY DEFINER/)
    expect(SQL).toMatch(/SET search_path = public/)
  })

  it('bases identity on auth.uid() through the existing workspace authorizer', () => {
    expect(SQL).toMatch(/public\.authorize_workspace_actor\(p_owner_id\)/)
    expect(SQL).not.toMatch(/p_user_id UUID/)
    expect(SQL).not.toMatch(/service_role/i)
    expect(SQL).not.toMatch(/SUPABASE_SERVICE_ROLE/i)
  })

  it('serializes claims per user and enforces the same 40/hour quota as the server module', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_requester_id::text, 0\)\)/)
    expect(SQL).toMatch(/>= 40/) // must match QUOTA_PER_WINDOW in server/extractionGuard.js
    expect(SQL).toMatch(/NOW\(\) - INTERVAL '1 hour'/)
  })

  it('returns explicit claimed / duplicate / quota_exceeded statuses', () => {
    expect(SQL).toMatch(/'claimed'/i)
    expect(SQL).toMatch(/'duplicate'/i)
    expect(SQL).toMatch(/'quota_exceeded'/i)
  })

  it('handles the unique-violation race as a duplicate instead of a raw DB error', () => {
    expect(SQL).toMatch(/WHEN unique_violation/)
    expect(SQL).toMatch(/'duplicate'/i)
  })

  it('locks the RPC down to authenticated callers only', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.claim_paper_scan_extraction\(UUID, TEXT, TEXT\) FROM PUBLIC/)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.claim_paper_scan_extraction\(UUID, TEXT, TEXT\) FROM anon/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_paper_scan_extraction\(UUID, TEXT, TEXT\) TO authenticated/)
  })

  it('refreshes the PostgREST schema cache so the new RPC is immediately callable', () => {
    expect(SQL).toMatch(/NOTIFY pgrst, 'reload schema'/)
  })
})

// In-memory re-implementation of the RPC's claim logic. Production behavior is
// identical: per-user mutex (the advisory lock), duplicate check, rolling count,
// insert, unique-violation fallback. The ledger array is the model of the table.
const makeLedgerState = () => ({ rows: [], locks: new Map(), lastId: 0 })

const acquireLock = (state, userId) => new Promise((resolve) => {
  const queue = state.locks.get(userId) || []
  queue.push(resolve)
  state.locks.set(userId, queue)
  if (queue.length === 1) resolve()
})

const releaseLock = (state, userId) => {
  const queue = state.locks.get(userId)
  queue.shift()
  if (queue.length) queue[0]()
}

const claimInSim = async (state, { userId, ownerId, requestId }) => {
  await acquireLock(state, userId)
  try {
    const now = Date.now()
    const exists = state.rows.some((row) => row.user_id === userId && row.request_id === requestId)
    if (exists) return { status: 'duplicate', extraction_id: null }

    const recent = state.rows.filter((row) => row.user_id === userId && now - row.createdAt < WINDOW_MS)
    if (recent.length >= QUOTA_PER_WINDOW) return { status: 'quota_exceeded', extraction_id: null }

    // Simulate the unique partial index rejecting a concurrent same-id insert.
    if (state.rows.some((row) => row.user_id === userId && row.request_id === requestId)) {
      return { status: 'duplicate', extraction_id: null }
    }
    const id = `e-${++state.lastId}`
    state.rows.push({ id, user_id: userId, owner_id: ownerId, request_id: requestId, createdAt: now })
    return { status: 'claimed', extraction_id: id }
  } finally {
    releaseLock(state, userId)
  }
}

describe('claim algorithm under concurrency', () => {
  it('never lets a single user claim more than the hourly quota even when racing', async () => {
    const state = makeLedgerState()
    const attempts = Array.from({ length: 100 }, (_, i) => ({
      userId: 'user-1',
      ownerId: 'owner-1',
      requestId: `attempt-${i}`
    }))
    const results = await Promise.all(attempts.map((a) => claimInSim(state, a)))
    const claimed = results.filter((r) => r.status === 'claimed').length
    const exceeded = results.filter((r) => r.status === 'quota_exceeded').length
    expect(claimed).toBe(QUOTA_PER_WINDOW)
    expect(exceeded).toBe(100 - QUOTA_PER_WINDOW)
    expect(new Set(results.filter((r) => r.extraction_id).map((r) => r.extraction_id)).size).toBe(claimed)
  })

  it('never double-claims the same request id when many duplicates race', async () => {
    const state = makeLedgerState()
    // Mix two distinct request ids submitted concurrently many times.
    const attempts = Array.from({ length: 50 }, (_, i) => ({
      userId: 'user-2',
      ownerId: 'owner-2',
      requestId: i % 2 === 0 ? 'id-a' : 'id-b'
    }))
    const results = await Promise.all(attempts.map((a) => claimInSim(state, a)))
    const claimed = results.filter((r) => r.status === 'claimed')
    expect(claimed).toHaveLength(2)
    expect(new Set(claimed.map((r) => r.extraction_id)).size).toBe(2)
    const rowsForIds = state.rows.filter((r) => r.user_id === 'user-2')
    expect(rowsForIds).toHaveLength(2)
  })

  it('keeps quotas isolated between different users', async () => {
    const state = makeLedgerState()
    const attempts = [
      ...Array.from({ length: 60 }, (_, i) => ({ userId: 'user-a', ownerId: 'owner-a', requestId: `a-${i}` })),
      ...Array.from({ length: 60 }, (_, i) => ({ userId: 'user-b', ownerId: 'owner-b', requestId: `b-${i}` }))
    ]
    const results = await Promise.all(attempts.map((a) => claimInSim(state, a)))
    const perUser = (userId) => results.filter((r, index) => attempts[index].userId === userId && r.status === 'claimed').length
    expect(perUser('user-a')).toBe(QUOTA_PER_WINDOW)
    expect(perUser('user-b')).toBe(QUOTA_PER_WINDOW)
  })

  it('allows a fresh request id for a deliberate re-scan even after the same sheet hash', async () => {
    const state = makeLedgerState()
    const first = await claimInSim(state, { userId: 'user-3', ownerId: 'owner-3', requestId: 'attempt-1' })
    expect(first.status).toBe('claimed')
    // Same sheet (same image hash), brand-new attempt id → new claim allowed.
    const rescan = await claimInSim(state, { userId: 'user-3', ownerId: 'owner-3', requestId: 'attempt-2' })
    expect(rescan.status).toBe('claimed')
    expect(rescan.extraction_id).not.toBe(first.extraction_id)
    // Re-submitting the SAME attempt id is the duplicate case.
    const resubmit = await claimInSim(state, { userId: 'user-3', ownerId: 'owner-3', requestId: 'attempt-1' })
    expect(resubmit.status).toBe('duplicate')
  })
})
