import { describe, expect, it, vi } from 'vitest'
import {
  REVIEW_TABLE_SELECT,
  createReviewTableFetcher,
  loadAllMonthReviewRows
} from './memberDataReviewLoader'

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

  it('falls back to an unfiltered safe read when the schema lacks user_id/deleted_at/member_code', async () => {
    let first = true
    let fallbackSelectCols = ''
    const supabase = {
      from: () => {
        const chain = {
          select: (cols) => {
            chain.selectCols = cols
            fallbackSelectCols = cols
            return chain
          },
          eq: () => chain,
          is: () => chain,
          then: (resolve) => {
            if (first) {
              first = false
              return resolve({ data: null, error: { message: 'column user_id does not exist' } })
            }
            return resolve({ data: [
              { id: 'a', deleted_at: null },
              { id: 'b', deleted_at: '2026-08-01T00:00:00Z' }
            ], error: null })
          }
        }
        return chain
      }
    }
    const fetcher = createReviewTableFetcher({ supabase, ownerId: '11111111-1111-1111-1111-111111111111', isConfigured: true })
    const rows = await fetcher('January_2026')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('a')
    // The fallback must not select member_code, which older tables lack.
    expect(fallbackSelectCols).not.toContain('member_code')
  })

  it('returns empty when not configured', async () => {
    const fetcher = createReviewTableFetcher({ supabase: {}, ownerId: 'owner-1', isConfigured: false })
    expect(await fetcher('January_2026')).toEqual([])
  })

  it('skips the uuid-filtered query for a non-uuid owner and uses the safe fallback', async () => {
    let eqCalled = false
    let fallbackCols = ''
    const supabase = {
      from: () => {
        const chain = {
          select: (cols) => {
            chain.cols = cols
            fallbackCols = cols
            return chain
          },
          eq: () => { eqCalled = true; return chain },
          is: () => chain,
          then: (resolve) => resolve({ data: [{ id: 'a', deleted_at: null }], error: null })
        }
        return chain
      }
    }
    const fetcher = createReviewTableFetcher({ supabase, ownerId: 'dev-bypass-user', isConfigured: true })
    const rows = await fetcher('January_2026')
    expect(rows).toHaveLength(1)
    expect(eqCalled).toBe(false)
    expect(fallbackCols).not.toContain('member_code')
  })
})
