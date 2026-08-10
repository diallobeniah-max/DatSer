// @vitest-environment jsdom
import React, { StrictMode, useEffect } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  markBackendDegraded,
  markBackendHealthy,
  resetHealthCoordinator
} from '../utils/backendHealthCoordinator'
import { SYNC_RETRY_LIMIT } from '../utils/offlineStore'

let pendingStore = []
let resilientResponder = null
let resilientRpcCallCount = 0
let capturedResilientArgs = null
let authState = null

const createMemoryStorage = () => {
  let store = {}

  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value)
    },
    removeItem: (key) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
    key: (index) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length
    }
  }
}

vi.mock('../lib/supabase', () => {
  const makeQuery = () => {
    const base = {
      select: () => base,
      eq: () => base,
      in: () => base,
      gt: () => base,
      limit: () => base,
      order: () => base,
      range: () => Promise.resolve({ data: [], error: null }),
      single: () => {
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
      on: () => ch,
      subscribe: () => ch
    }
    return ch
  }

  return {
    supabase: {
      from: () => makeQuery(),
      rpc: (name, args) => {
        if (name === 'get_owner_workspace_name') {
          return Promise.resolve({ data: 'Workspace', error: null })
        }
        if (name === 'get_owner_locked_date') {
          return Promise.resolve({ data: null, error: null })
        }
        if (name === 'get_available_month_tables') {
          return Promise.resolve({
            data: [{ table_name: 'January_2026' }, { table_name: 'February_2026' }],
            error: null
          })
        }
        if (name === 'get_table_columns') {
          return Promise.resolve({ data: [], error: null })
        }
        if (name === 'update_member_record_resilient') {
          resilientRpcCallCount += 1
          capturedResilientArgs = args
          if (resilientResponder) {
            return Promise.resolve({ data: resilientResponder, error: null })
          }
          return Promise.resolve({
            data: null,
            error: { message: 'Service Unavailable', status: 503 }
          })
        }
        return Promise.resolve({ data: null, error: null })
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'collab-1' } } } })
      },
      channel,
      removeChannel: () => {}
    }
  }
})

// Keep the real retry-policy helpers (SYNC_RETRY_LIMIT, backoff, eligibility,
// failure bookkeeping, reconciliation) but swap the IndexedDB-backed storage for
// an in-memory store. updateOfflineChangeStatus mirrors production: a transition
// to pending/failed records last_attempt_at and advances retry_count so the real
// backoff gate actually engages.
vi.mock('../utils/offlineStore', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    initOfflineStore: vi.fn(() => Promise.resolve(undefined)),
    isOfflineStoreAvailable: vi.fn(() => Promise.resolve(true)),
    saveOfflineSnapshot: vi.fn(() => Promise.resolve(true)),
    getOfflineSnapshot: vi.fn(() => Promise.resolve(null)),
    getPendingOfflineChanges: vi.fn(() => Promise.resolve(pendingStore.map((c) => ({ ...c })))),
    updateOfflineChangeStatus: vi.fn((id, patch) => {
      const change = pendingStore.find((c) => c.local_change_id === id)
      if (change) {
        Object.assign(change, patch)
        if (patch.sync_status === 'pending' || patch.sync_status === 'failed') {
          change.retry_count = patch.retry_count ?? (Number(change.retry_count || 0) + 1)
          change.last_attempt_at = new Date().toISOString()
        }
      }
      return Promise.resolve(true)
    }),
    removeOfflineChange: vi.fn((id) => {
      pendingStore = pendingStore.filter((c) => c.local_change_id !== id)
      return Promise.resolve(true)
    }),
    queueOfflineChange: vi.fn((change) => {
      pendingStore.push(change)
      return Promise.resolve(true)
    }),
    clearAllOfflineData: vi.fn(() => {
      pendingStore = []
      return Promise.resolve(true)
    }),
    getMemberPreviewMembers: vi.fn(() => Promise.resolve([])),
    saveMemberPreviewMembers: vi.fn(() => Promise.resolve(true)),
    deleteMemberPreviewMember: vi.fn(() => Promise.resolve(true)),
    filterPreviewMembersForWrite: (members) => members
  }
})

vi.mock('./AuthContext', () => ({
  useAuth: () => authState
}))

vi.mock('react-toastify', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    dismiss: vi.fn(),
    clearWaitingQueue: vi.fn()
  }
}))

vi.mock('../utils/notify', () => ({
  notify: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    sync: vi.fn(),
    online: vi.fn()
  }
}))

const seededMemberUpdateChange = (overrides = {}) => ({
  local_change_id: 'member_update_January_2026_member-1',
  action_type: 'member_update',
  table_name: 'January_2026',
  owner_id: 'collab-1',
  member_id: 'member-1',
  identity: null,
  updates: { full_name: 'Alice Updated' },
  created_at: '2026-01-04T10:00:00.000Z',
  sync_status: 'pending',
  ...overrides
})

const seededMemberAddChange = (overrides = {}) => ({
  local_change_id: 'member_add_January_2026_member-9',
  action_type: 'member_add',
  table_name: 'January_2026',
  owner_id: 'collab-1',
  member_id: 'member-9',
  identity: null,
  member_data: { id: 'member-9', full_name: 'Queued Member' },
  created_at: '2026-01-04T10:00:00.000Z',
  sync_status: 'pending',
  ...overrides
})

describe('AppContext offline sync flush retry safety', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'test-key'
    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true
      })
    }
    localStorage.clear()
    resetHealthCoordinator()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    pendingStore = []
    resilientResponder = null
    resilientRpcCallCount = 0
    capturedResilientArgs = null
    authState = {
      user: { id: 'collab-1', email: 'collab@example.com' },
      loading: false,
      personalPreferences: {},
      preferencesHydrated: true,
      preferencesLoading: false,
      preferencesError: null,
      get preferences() {
        return { ...this.personalPreferences }
      },
      savePersonalPreferences: vi.fn(async () => true),
      updatePreference: vi.fn()
    }
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const advance = async (ms) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  const mountApp = async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const app = useApp()
      useEffect(() => {
        onState(app)
      }, [app, onState])
      return null
    }
    let latest = null
    const renderResult = render(
      <AppProvider>
        <StateProbe
          onState={(state) => {
            latest = state
          }}
        />
      </AppProvider>
    )
    await advance(100)
    return {
      ...renderResult,
      getLatest: () => latest
    }
  }

  it('keeps a member_update queued (pending, not removed) when a transient flush failure occurs', async () => {
    pendingStore = [seededMemberUpdateChange()]
    const { getLatest } = await mountApp()

    await advance(5000)

    expect(resilientRpcCallCount).toBe(3)
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('pending')
    expect(getLatest().pendingSyncCount).toBe(1)
    expect(getLatest().isSyncingOffline).toBe(false)

    // Backoff keeps the change pending without hammering.
    await advance(5000)
    expect(resilientRpcCallCount).toBe(3)
  })

  it('advances retry_count/last_attempt_at through the real backoff policy on repeated failures', async () => {
    pendingStore = [seededMemberUpdateChange()]
    const { getLatest } = await mountApp()

    await advance(5000)
    expect(resilientRpcCallCount).toBe(3)
    expect(pendingStore[0].sync_status).toBe('pending')
    expect(pendingStore[0].retry_count).toBe(1)
    expect(pendingStore[0].last_attempt_at).toBeTruthy()

    // retry_count 1 -> backoff 60s; the next attempt fires after the window.
    await advance(61000)
    expect(resilientRpcCallCount).toBe(6)
    expect(pendingStore[0].sync_status).toBe('pending')
    expect(pendingStore[0].retry_count).toBe(2)
    expect(pendingStore).toHaveLength(1)
    expect(getLatest().pendingSyncCount).toBe(1)
    expect(getLatest().isSyncingOffline).toBe(false)
  })

  it('removes the queued change once a flush succeeds', async () => {
    pendingStore = [seededMemberUpdateChange()]
    resilientResponder = {
      success: true,
      row: { id: 'member-1', full_name: 'Alice Updated' },
      member_id: 'member-1'
    }
    const { getLatest } = await mountApp()

    await advance(5000)

    expect(resilientRpcCallCount).toBe(1)
    expect(pendingStore).toHaveLength(0)
    expect(getLatest().pendingSyncCount).toBe(0)
    expect(getLatest().isSyncingOffline).toBe(false)
  })

  it('automatically retries after reconnecting without pressing Sync Now with no duplicate writes', async () => {
    pendingStore = [seededMemberUpdateChange()]
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { getLatest } = await mountApp()

    await advance(5000)
    expect(resilientRpcCallCount).toBe(0)
    expect(getLatest().pendingSyncCount).toBe(1)

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await advance(3000)

    // Exactly one flush after reconnecting: the retry budget remains bounded
    // (3 calls = 1 attempt + 2 retries) and the change is not dropped.
    expect(resilientRpcCallCount).toBe(3)
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('pending')
    expect(getLatest().isSyncingOffline).toBe(false)
  })

  it('automatically retries once the backend recovers from a degraded state (single flush)', async () => {
    markBackendDegraded({ message: 'Service Unavailable', status: 503 })
    pendingStore = [seededMemberUpdateChange()]
    const { getLatest } = await mountApp()

    await advance(5000)
    expect(resilientRpcCallCount).toBe(0)
    expect(getLatest().pendingSyncCount).toBe(1)

    await act(async () => {
      markBackendHealthy()
    })
    await advance(3000)

    // One eligible scheduled flush after recovery, no duplicate writes.
    expect(resilientRpcCallCount).toBe(3)
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('pending')
  })

  it('never runs overlapping flushes (in-flight guard)', async () => {
    pendingStore = [seededMemberUpdateChange()]
    const { getLatest } = await mountApp()

    let results
    await act(async () => {
      const first = getLatest().syncOfflineChanges()
      const second = getLatest().syncOfflineChanges()
      await vi.advanceTimersByTimeAsync(5000)
      results = await Promise.all([first, second])
    })

    expect(results[0].success).toBe(false)
    expect(results[1].syncing).toBe(true)
    expect(resilientRpcCallCount).toBe(3)
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('pending')
  })

  it('manual Sync Now bypasses the backoff wait and advances bookkeeping', async () => {
    pendingStore = [seededMemberUpdateChange({
      retry_count: 1,
      last_attempt_at: new Date().toISOString()
    })]
    const { getLatest } = await mountApp()

    await advance(5000)
    expect(resilientRpcCallCount).toBe(0)

    let result
    await act(async () => {
      const flushPromise = getLatest().syncOfflineChanges({ manual: true })
      await vi.advanceTimersByTimeAsync(5000)
      result = await flushPromise
    })

    expect(result.synced).toBe(0)
    expect(resilientRpcCallCount).toBe(3)
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('pending')
    expect(pendingStore[0].retry_count).toBe(2)
  })

  it('retry budget exhaustion becomes a recoverable failed change, never deleted, and stops auto-hammering', async () => {
    pendingStore = [seededMemberUpdateChange()]
    const { getLatest } = await mountApp()

    await advance(5000)
    expect(pendingStore[0].retry_count).toBe(1)
    expect(pendingStore[0].sync_status).toBe('pending')

    // Each subsequent window exceeds the previous backoff step plus slack so
    // the auto-flush is guaranteed to fire once per window.
    await advance(65000)
    expect(pendingStore[0].retry_count).toBe(2)
    await advance(125000)
    expect(pendingStore[0].retry_count).toBe(3)
    await advance(305000)
    expect(pendingStore[0].retry_count).toBe(4)
    await advance(905000)
    expect(pendingStore[0].retry_count).toBe(SYNC_RETRY_LIMIT)
    expect(pendingStore[0].sync_status).toBe('failed')
    expect(pendingStore[0].error).toMatch(/retry from Settings/i)

    // Bounded: 5 attempts x 3 calls each. Not deleted; kept as recoverable.
    expect(resilientRpcCallCount).toBe(15)
    expect(pendingStore).toHaveLength(1)
    expect(getLatest().pendingSyncCount).toBe(1)
    expect(getLatest().isSyncingOffline).toBe(false)

    // No further automatic attempts after exhaustion.
    const rpcAtExhaustion = resilientRpcCallCount
    await advance(905000)
    expect(resilientRpcCallCount).toBe(rpcAtExhaustion)
    expect(pendingStore[0].sync_status).toBe('failed')
  })

  it('pauses auto-sync in forced offline mode and pending changes survive remount', async () => {
    localStorage.setItem('datser_offline_mode', 'offline')
    pendingStore = [seededMemberUpdateChange()]
    const firstMount = await mountApp()

    await advance(5000)
    expect(resilientRpcCallCount).toBe(0)
    expect(firstMount.getLatest().pendingSyncCount).toBe(1)

    firstMount.unmount()
    await act(async () => {})

    const secondMount = await mountApp()
    await advance(5000)

    expect(resilientRpcCallCount).toBe(0)
    expect(pendingStore).toHaveLength(1)
    expect(secondMount.getLatest().pendingSyncCount).toBe(1)
    secondMount.unmount()
  })

  it('a queued member_add against a server-deleted member is reconciled, not resurrected', async () => {
    pendingStore = [seededMemberAddChange()]
    const { getLatest } = await mountApp()

    await advance(5000)

    // The pre-check sees no live server row for the id, so the add is failed
    // and tombstoned instead of upserted (no resurrect, no auto-retry loop).
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('failed')
    expect(pendingStore[0].error).toMatch(/deleted on the server/i)
    expect(resilientRpcCallCount).toBe(0)
    expect(getLatest().isSyncingOffline).toBe(false)

    const rpcBefore = resilientRpcCallCount
    await advance(905000)
    expect(resilientRpcCallCount).toBe(rpcBefore)
    expect(pendingStore[0].sync_status).toBe('failed')
  })

  it('recreates the flush scheduler after a StrictMode dispose/remount so auto-sync still fires', async () => {
    pendingStore = [seededMemberUpdateChange()]
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const app = useApp()
      useEffect(() => {
        onState(app)
      }, [app, onState])
      return null
    }
    let latest = null
    render(
      <StrictMode>
        <AppProvider>
          <StateProbe
            onState={(state) => {
              latest = state
            }}
          />
        </AppProvider>
      </StrictMode>
    )
    await advance(100)

    // React StrictMode runs mount -> cleanup -> mount, which disposes the first
    // scheduler. The scheduler must be recreated so the eligible flush still runs.
    await advance(5000)
    expect(resilientRpcCallCount).toBe(3)
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('pending')
    expect(latest.isSyncingOffline).toBe(false)
  })

  it('queued replay sends canonical PascalCase month-table column names', async () => {
    pendingStore = [seededMemberUpdateChange({
      updates: {
        Gender: 'Male',
        'Phone Number': '0550000000',
        'Full Name': 'Alice Updated',
        'Current Level': 'SHS1'
      }
    })]
    await mountApp()

    await advance(5000)

    expect(resilientRpcCallCount).toBe(3)
    expect(capturedResilientArgs?.p_updates).toMatchObject({
      Gender: 'Male',
      'Phone Number': '0550000000',
      'Full Name': 'Alice Updated',
      'Current Level': 'SHS1'
    })
    // Snake_case aliases must not leak into the replay payload.
    expect(capturedResilientArgs.p_updates.gender).toBeUndefined()
    expect(capturedResilientArgs.p_updates.phone_number).toBeUndefined()
    expect(capturedResilientArgs.p_updates.full_name).toBeUndefined()
    expect(capturedResilientArgs.p_updates.current_level).toBeUndefined()
    expect(pendingStore).toHaveLength(1)
    expect(pendingStore[0].sync_status).toBe('pending')
  })

  it('maps snake_case queued fields to canonical month-table columns on replay', async () => {
    pendingStore = [seededMemberUpdateChange({
      updates: {
        gender: 'Female',
        phone_number: '0551111111',
        full_name: 'Bob Updated'
      }
    })]
    await mountApp()

    await advance(5000)

    expect(resilientRpcCallCount).toBe(3)
    expect(capturedResilientArgs?.p_updates).toMatchObject({
      Gender: 'Female',
      'Phone Number': '0551111111',
      'Full Name': 'Bob Updated'
    })
    expect(capturedResilientArgs.p_updates.gender).toBeUndefined()
    expect(capturedResilientArgs.p_updates.phone_number).toBeUndefined()
    expect(capturedResilientArgs.p_updates.full_name).toBeUndefined()
  })
})
