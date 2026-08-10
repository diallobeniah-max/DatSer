import { describe, expect, it, vi } from 'vitest'
import {
  REVIEW_TABLE_SELECT,
  createReviewTableFetcher,
  loadAllMonthReviewRows
} from './memberDataReviewLoader'

describe('REVIEW_TABLE_SELECT', () => {
  it('does not request the member_code column, which live month tables lack', () => {
    expect(REVIEW_TABLE_SELECT).not.toContain('member_code')
  })
})

const makeSupabaseMock = ({ data = [], error = null }) => {
  const calls = { from: 0, rpc: 0, insert: 0, update: 0, delete: 0, table: null }
  const chain = {
    select: (cols) => {
      calls.selectCols = cols
      return chain
    },
    eq: () => chain,
    is: () => chain,
    then: (resolve) => resolve(error ? { data: null, error } : { data, error: null })
  }
  return {
    supabase: {
      from: (table) => {
        calls.from += 1
        calls.table = table
        return chain
      },
      rpc: () => { calls.rpc += 1; return Promise.resolve({ data: null, error: null }) },
      insert: () => { calls.insert += 1; return chain },
      update: () => { calls.update += 1; return chain },
      delete: () => { calls.delete += 1; return chain }
    },
    calls
  }
}

describe('loadAllMonthReviewRows', () => {
  it('loads every table with bounded concurrency', async () => {
    let active = 0
    let maxActive = 0
    const fetchTableRows = vi.fn(async (table) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return [{ id: table }]
    })
    const result = await loadAllMonthReviewRows({
      tables: ['January_2026', 'February_2026', 'March_2026', 'April_2026'],
      fetchTableRows,
      concurrency: 2
    })
    expect(result.size).toBe(4)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(fetchTableRows).toHaveBeenCalledTimes(4)
  })

  it('degrades a failing table to an empty list', async () => {
    const fetchTableRows = vi.fn(async (table) => {
      if (table === 'Broken_2026') throw new Error('boom')
      return [{ id: 'x' }]
    })
    const result = await loadAllMonthReviewRows({
      tables: ['January_2026', 'Broken_2026'],
      fetchTableRows
    })
    expect(result.get('January_2026')).toHaveLength(1)
    expect(result.get('Broken_2026')).toEqual([])
  })

  it('returns an empty Map for no tables', async () => {
    const result = await loadAllMonthReviewRows({ tables: [], fetchTableRows: vi.fn() })
    expect(result.size).toBe(0)
  })
})

describe('createReviewTableFetcher', () => {
  it('performs zero mutation calls — reads via select/eq/is only', async () => {
    const { supabase, calls } = makeSupabaseMock({ data: [
      { id: 'a', deleted_at: null, 'Full Name': 'Alice' },
      { id: 'b', deleted_at: '2026-08-01T00:00:00Z', 'Full Name': 'Bob' }
    ] })
    const fetcher = createReviewTableFetcher({ supabase, ownerId: '11111111-1111-1111-1111-111111111111', isConfigured: true })
    const rows = await fetcher('January_2026')

    expect(calls.from).toBe(1)
    expect(calls.table).toBe('January_2026')
    expect(calls.selectCols).toBe(REVIEW_TABLE_SELECT)
    expect(calls.rpc).toBe(0)
    expect(calls.insert).toBe(0)
    expect(calls.update).toBe(0)
    expect(calls.delete).toBe(0)
    // soft-deleted rows are excluded
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('a')
  })

  it('owner-filtered query error fails closed and performs zero unscoped fallback reads', async () => {
    let fromCalls = 0
    const supabase = {
      from: () => {
        fromCalls += 1
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve) => resolve({ data: null, error: { message: 'column user_id does not exist' } })
        }
        return chain
      }
    }
    const fetcher = createReviewTableFetcher({ supabase, ownerId: '11111111-1111-1111-1111-111111111111', isConfigured: true })
    await expect(fetcher('January_2026')).rejects.toMatchObject({ reviewFailClosed: true })
    // The owner-scoped query ran once; no unscoped fallback read was attempted.
    expect(fromCalls).toBe(1)
  })

  it('returns empty when not configured', async () => {
    const fetcher = createReviewTableFetcher({ supabase: {}, ownerId: 'owner-1', isConfigured: false })
    expect(await fetcher('January_2026')).toEqual([])
  })

  it('non-UUID owner fails closed and performs zero unscoped table reads', async () => {
    let fromCalls = 0
    const supabase = {
      from: () => {
        fromCalls += 1
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve) => resolve({ data: [{ id: 'a', deleted_at: null }], error: null })
        }
        return chain
      }
    }
    const fetcher = createReviewTableFetcher({ supabase, ownerId: 'dev-bypass-user', isConfigured: true })
    await expect(fetcher('January_2026')).rejects.toMatchObject({ reviewFailClosed: true })
    // A non-UUID owner must never trigger a table read (owned or unscoped).
    expect(fromCalls).toBe(0)
  })

  it('propagates fail-closed fetcher errors instead of degrading to empty rows', async () => {
    const fetchTableRows = vi.fn(async () => {
      const error = new Error('invalid owner')
      error.reviewFailClosed = true
      throw error
    })
    await expect(loadAllMonthReviewRows({ tables: ['January_2026'], fetchTableRows })).rejects.toThrow('invalid owner')
  })
})
