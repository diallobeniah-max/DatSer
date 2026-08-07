import { describe, expect, it } from 'vitest'
import { getAutoHistoricalSearchKey, shouldAutoSearchHistorical } from './autoHistoricalSearch'

const base = { query: 'Ben', loading: false, isSearchingOtherMonths: false, isShortSearchDisplayActive: false, visibleCount: 0, alreadyFired: false }

describe('automatic historical search fallback (Bug 2)', () => {
  it('A: zero current matches → historical search fires', () => {
    expect(shouldAutoSearchHistorical({ ...base, visibleCount: 0 })).toBe(true)
  })

  it('B: a current match exists → historical search does NOT fire', () => {
    expect(shouldAutoSearchHistorical({ ...base, visibleCount: 1 })).toBe(false)
    expect(shouldAutoSearchHistorical({ ...base, visibleCount: 5 })).toBe(false)
  })

  it('C: the same term does not repeatedly fire (already fired guard)', () => {
    expect(shouldAutoSearchHistorical({ ...base, alreadyFired: true })).toBe(false)
  })

  it('D: a term change triggers a new search (distinct key, not already fired)', () => {
    expect(getAutoHistoricalSearchKey('August_2026', 'Ben')).not.toBe(getAutoHistoricalSearchKey('August_2026', 'Akrofi'))
    expect(shouldAutoSearchHistorical({ ...base, query: 'Akrofi', alreadyFired: false })).toBe(true)
  })

  it('E: a current-table/month change can trigger a new search (distinct key)', () => {
    expect(getAutoHistoricalSearchKey('August_2026', 'Ben')).not.toBe(getAutoHistoricalSearchKey('January_2026', 'Ben'))
    expect(shouldAutoSearchHistorical({ ...base, alreadyFired: false })).toBe(true)
  })

  it('F: mutation re-evaluation — a reappearing current match drops the guard, then 0 matches can fire again', () => {
    // Simulate the effect lifecycle: a current match exists => no fire (guard dropped).
    expect(shouldAutoSearchHistorical({ ...base, visibleCount: 1, alreadyFired: false })).toBe(false)
    // After the mutation/import is reverted, zero matches + not already fired => can fire again.
    expect(shouldAutoSearchHistorical({ ...base, visibleCount: 0, alreadyFired: false })).toBe(true)
  })

  it('G: a deleted current result does NOT suppress the fallback (visibleCount is 0)', () => {
    // Deleted matches are tombstones, not visible results, so visibleCount is 0.
    expect(shouldAutoSearchHistorical({ ...base, visibleCount: 0 })).toBe(true)
  })

  it('H: a still-loading search never fires early', () => {
    expect(shouldAutoSearchHistorical({ ...base, loading: true })).toBe(false)
  })

  it('I: manual fallback stays available — only the auto path is guarded', () => {
    // After an auto fire marks the key, the same term is not auto-fired again.
    expect(shouldAutoSearchHistorical({ ...base, alreadyFired: true })).toBe(false)
    // A different (table, term) not yet fired still triggers the auto path.
    expect(shouldAutoSearchHistorical({ ...base, query: 'New Term', alreadyFired: false })).toBe(true)
  })

  it('J: no infinite loop — fired key stays fired for the same settled state', () => {
    const key = getAutoHistoricalSearchKey('August_2026', 'Ben')
    const fired = new Set([key])
    expect(shouldAutoSearchHistorical({ ...base, alreadyFired: fired.has(key) })).toBe(false)
  })

  it('rejects empty / single-character terms and the short-search tray', () => {
    expect(shouldAutoSearchHistorical({ ...base, query: '' })).toBe(false)
    expect(shouldAutoSearchHistorical({ ...base, query: '  ' })).toBe(false)
    expect(shouldAutoSearchHistorical({ ...base, query: 'B' })).toBe(false)
    expect(shouldAutoSearchHistorical({ ...base, isShortSearchDisplayActive: true })).toBe(false)
    expect(shouldAutoSearchHistorical({ ...base, isSearchingOtherMonths: true })).toBe(false)
  })
})
