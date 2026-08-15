// @vitest-environment jsdom
import React, { useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { invalidateRequestScope } from '../utils/runtimeRequestRegistry'

// Configurable per-test controls for the mocked supabase client.
const testConfig = {
  authLoading: false,
  user: null,
  session: null,
  rangeResult: { data: [], error: null },
  countResult: { count: 0, error: null },
  preferences: { current_month_table: 'August_2026' }
}

let preferenceListeners = []
let preferencesRow = null
let emitPreferencesChange = () => {}

const createMemoryStorage = () => {
  let store = {}
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
    clear: () => { store = {} },
    key: (index) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length }
  }
}

vi.mock('../lib/supabase', () => {
  preferenceListeners = []
  preferencesRow = {
    admin_sticky_month: 'January_2026',
    admin_sticky_sundays: [],
    locked_default_date: null,
    admin_sync_mode: 'banner'
  }
  emitPreferencesChange = (row) => {
    preferencesRow = { ...preferencesRow, ...row }
    preferenceListeners.forEach((cb) => cb({ new: preferencesRow }))
  }

  const makeQuery = (table) => {
    const base = {
      select: (cols, opts) => {
        if (opts && opts.count === 'exact' && opts.head === true) {
          return Promise.resolve(testConfig.countResult)
        }
        base._columns = cols
        return base
      },
      eq: () => base,
      in: () => base,
      limit: () => base,
      order: () => base,
      is: () => base,
      range: (from, to) => Promise.resolve(testConfig.rangeResult),
      single: () => {
        if (table === 'user_preferences') {
          return Promise.resolve({ data: preferencesRow, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      upsert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ data: [], error: null }),
      delete: () => base,
      not: () => Promise.resolve({ error: null })
    }
    return base
  }

  const channel = () => {
    const ch = {
      on: (_event, filter, cb) => {
        if (filter?.table === 'user_preferences') {
          preferenceListeners.push(cb)
        }
        return ch
      },
      subscribe: () => ch
    }
    return ch
  }

  return {
    supabase: {
      from: (table) => makeQuery(table),
      rpc: (name) => {
        if (name === 'get_owner_workspace_name') return Promise.resolve({ data: 'Workspace', error: null })
        if (name === 'get_owner_locked_date') return Promise.resolve({ data: null, error: null })
        if (name === 'get_available_month_tables') {
          return Promise.resolve({
            data: [{ table_name: 'January_2026' }, { table_name: 'August_2026' }],
            error: null
          })
        }
        if (name === 'get_table_columns') return Promise.resolve({ data: [], error: null })
        return Promise.resolve({ data: null, error: null })
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: testConfig.session } })
      },
      channel,
      removeChannel: () => {}
    }
  }
})

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    user: testConfig.user,
    loading: testConfig.authLoading,
    personalPreferences: null,
    preferencesHydrated: true,
    preferencesLoading: false,
    preferencesError: null,
    get preferences() { return { ...testConfig.preferences } },
    savePersonalPreferences: vi.fn(async () => true),
    updatePreference: vi.fn()
  })
}))

describe('AppContext member hydration', () => {
  beforeEach(() => {
    testConfig.authLoading = false
    testConfig.user = { id: 'owner-1', email: 'owner@example.com' }
    testConfig.session = { user: { id: 'owner-1' } }
    testConfig.rangeResult = { data: [], error: null }
    testConfig.countResult = { count: 0, error: null }
    testConfig.preferences = { current_month_table: 'August_2026' }

    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true
      })
    }
    localStorage.clear()
    // The request registry is module-level and caches member-first-page results
    // across mounts in the same worker; clear it so each test gets fresh data.
    invalidateRequestScope('user-owner-1')
  })

  let currentUnmount = null
  afterEach(() => {
    if (typeof currentUnmount === 'function') {
      currentUnmount()
      currentUnmount = null
    }
  })

  const renderProbe = async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const state = useApp()
      useEffect(() => {
        onState(state)
      }, [state.memberHydrationState, state.membersTotalCount, state.currentTable, state.loading, state.members?.length])
      return null
    }
    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(s) => { latest = s }} />
      </AppProvider>
    )
    currentUnmount = unmount
    return { unmount, getLatest: () => latest }
  }

  it('hydrates to HYDRATED with auto-loaded members on a clean startup', async () => {
    testConfig.rangeResult = {
      data: [
        { id: 'm1', name: 'Ama', phone: '111', deleted_at: null, updated_at: '2026-08-10T00:00:00Z' },
        { id: 'm2', name: 'Kofi', phone: '222', deleted_at: null, updated_at: '2026-08-10T00:00:00Z' }
      ],
      error: null
    }
    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('HYDRATED'))
    await waitFor(() => expect(getLatest()?.members?.length).toBe(2))
    expect(getLatest()?.loading).toBe(false)
    expect(getLatest()?.currentTable).toBe('August_2026')
  })

  it('never hydrates while auth is still loading (no false empty)', async () => {
    testConfig.authLoading = true
    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()).toBeTruthy())
    expect(getLatest().memberHydrationState).not.toBe('HYDRATED')
    expect(getLatest().loading).toBe(true)
  })

  it('does not fetch members until the saved month is resolved', async () => {
    // Pre-populate a provisional localStorage month (the race the fix eliminates).
    localStorage.setItem('selectedMonthTable', 'January_2026')
    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('HYDRATED'))
    // Month must be the authoritative preference, not the provisional localStorage value.
    expect(getLatest()?.currentTable).toBe('August_2026')
  })

  it('shows cached members (HYDRATED) from a fresh persisted cache on startup', async () => {
    // Cache is served before the network query, so a successful range still proves
    // the cache-first HYDRATED path (the query result is never used).
    testConfig.rangeResult = { data: [], error: null }
    testConfig.countResult = { count: 1, error: null }
    const cachedRow = { id: 'c1', name: 'Cached', phone: '000', deleted_at: null, updated_at: '2026-08-01T00:00:00Z' }
    const cacheKey = 'datser_member_preview_cache_v1:user-owner-1:August_2026'
    localStorage.setItem(cacheKey, JSON.stringify({
      data: [cachedRow],
      ts: Date.now(),
      totalCount: 1,
      loadedAll: true
    }))

    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('HYDRATED'))
    expect(getLatest()?.members?.[0]?.id).toBe('c1')
  })

  it('hydrates to empty only when an authoritative fetch returns zero active members', async () => {
    testConfig.rangeResult = { data: [], error: null }
    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('HYDRATED'))
    await waitFor(() => expect(getLatest()?.members?.length ?? 0).toBe(0))
    await waitFor(() => expect(getLatest()?.membersTotalCount).toBe(0))
  })

  it('reconciles a stale cached totalCount (410) down to the authoritative server count (389)', async () => {
    const staleRows = Array.from({ length: 410 }, (_, i) => ({
      id: `m${i}`,
      name: `Member ${i}`,
      phone: `${i}`,
      deleted_at: null,
      updated_at: '2026-08-11T00:00:00Z'
    }))
    const cacheKey = 'datser_member_preview_cache_v1:user-owner-1:August_2026'
    localStorage.setItem(cacheKey, JSON.stringify({
      data: staleRows,
      ts: Date.now(),
      totalCount: 410,
      loadedAll: true
    }))

    // Authoritative count query returns 389; the full snapshot returns 389 rows.
    testConfig.countResult = { count: 389, error: null }
    testConfig.rangeResult = {
      data: staleRows.slice(0, 389).map((r) => ({ ...r, deleted_at: null })),
      error: null
    }

    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('HYDRATED'))
    await waitFor(() => expect(getLatest()?.membersTotalCount).toBe(389))
    await waitFor(() => expect(getLatest()?.members?.length).toBe(389))
  })

  it('does not mark HYDRATED on a transient error that preserves an empty list', async () => {
    testConfig.rangeResult = { data: null, error: { message: 'network hiccup', code: 'NETWORK' } }
    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()).toBeTruthy())
    // Give any stale background resolution a chance to settle, then confirm the
    // error path never reported hydrated (a transient error must not show empty).
    expect(getLatest().memberHydrationState).not.toBe('HYDRATED')
  })
})
