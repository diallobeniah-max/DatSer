// @vitest-environment jsdom
import React, { useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { invalidateRequestScope } from '../utils/runtimeRequestRegistry'
import { updateMemberV2LocalFlowGuard } from '../experiments/rxdb-member-phase1/memberV2FeatureFlag'

const localAdapterConfig = vi.hoisted(() => ({
  listLocalMembers: async () => [],
  offlineSnapshot: async () => null,
  eligibility: async () => ({ data: false, error: null }),
  eligibilityRequests: [],
}))

// Configurable per-test controls for the mocked supabase client.
const testConfig = {
  authLoading: false,
  user: null,
  session: null,
  rangeResult: { data: [], error: null },
  rangeResultForTable: null,
  countResult: { count: 0, error: null },
  preferences: { current_month_table: 'August_2026' },
  accessContext: { has_access: true, is_collaborator: false, owner_id: 'owner-1' }
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
    // Owner-switch tests hold the selected month constant; calendar overrides
    // belong in their own tests rather than racing the hydration request.
    admin_sticky_month: null,
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
      range: (from, to) => Promise.resolve(testConfig.rangeResultForTable?.(table, from, to) ?? testConfig.rangeResult),
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
      rpc: (name, args) => {
        if (name === 'member_v2_workspace_eligible') {
          localAdapterConfig.eligibilityRequests.push(args)
          return localAdapterConfig.eligibility(args)
        }
        if (name === 'get_current_user_access_context') return typeof testConfig.accessContext === 'function'
          ? testConfig.accessContext() : Promise.resolve({ data: testConfig.accessContext, error: null })
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

vi.mock('./AuthContext', () => {
  const auth = {
    get user() { return testConfig.user },
    get loading() { return testConfig.authLoading },
    personalPreferences: null,
    preferencesHydrated: true,
    preferencesLoading: false,
    preferencesError: null,
    get preferences() { return testConfig.preferences },
    savePersonalPreferences: vi.fn(async () => true),
    updatePreference: vi.fn()
  }
  return { useAuth: () => auth }
})

vi.mock('../experiments/rxdb-member-phase1/realMemberUiAdapter', () => ({
  getRealMemberV2UiAdapter: vi.fn(async ({ ownerId }) => ({
    listLocalMembers: (options) => localAdapterConfig.listLocalMembers({ ...options, ownerId }),
    listLocalAttendance: async () => [],
    subscribeLocalMembers: async () => () => {},
    subscribeLocalAttendance: async () => () => {},
  })),
  wakeRealMemberV2Sync: vi.fn(async () => ({})),
}))

vi.mock('../utils/offlineStore', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getOfflineSnapshot: async (...args) => localAdapterConfig.offlineSnapshot(...args),
  }
})

// Load after mock state is initialized, before individual test deadlines.
// Cold AppContext transforms can exceed 5s when the full suite runs in parallel.
const { AppProvider, useApp } = await import('./AppContext.jsx')
const { resetHealthCoordinator } = await import('../utils/backendHealthCoordinator')

describe('AppContext member hydration', () => {
  beforeEach(() => {
    resetHealthCoordinator()
    testConfig.authLoading = false
    testConfig.user = { id: 'owner-1', email: 'owner@example.com' }
    testConfig.session = { user: { id: 'owner-1' } }
    testConfig.rangeResult = { data: [], error: null }
    testConfig.rangeResultForTable = null
    testConfig.countResult = { count: 0, error: null }
    testConfig.preferences = { current_month_table: 'August_2026' }
    testConfig.accessContext = { has_access: true, is_collaborator: false, owner_id: 'owner-1' }
    localAdapterConfig.listLocalMembers = async () => []
    localAdapterConfig.offlineSnapshot = async () => null
    localAdapterConfig.eligibility = async () => ({ data: false, error: null })
    localAdapterConfig.eligibilityRequests = []
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_DATSER_MEMBER_V2_SHARED_WEB_VALIDATION', 'true')
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')

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
    vi.unstubAllEnvs()
    if (typeof currentUnmount === 'function') {
      currentUnmount()
      currentUnmount = null
    }
    resetHealthCoordinator()
  })

  const renderProbe = async () => {
    const StateProbe = ({ onState }) => {
      const state = useApp()
      useEffect(() => {
        onState(state)
      }, [state.memberHydrationState, state.membersTotalCount, state.currentTable, state.loading, state.members, state.dataOwnerId, state.offlineStatusMessage, state.offlineMode, state.offlineCacheMeta, state.memberV2Enabled])
      return null
    }
    let latest = null
    const renderTree = () => (
      <AppProvider>
        <StateProbe onState={(s) => { latest = s }} />
      </AppProvider>
    )
    const { unmount, rerender } = render(renderTree())
    currentUnmount = unmount
    return { unmount, rerender: () => rerender(renderTree()), getLatest: () => latest }
  }

  const enableHostedBuild = () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_DATSER_MEMBER_V2_HOSTED_ROLLOUT', 'true')
  }

  it.each([true, false, 'failure'])('publishes the resolved workspace route for eligibility %s', async (eligible) => {
    enableHostedBuild()
    localAdapterConfig.eligibility = async () => eligible === 'failure'
      ? { data: null, error: { message: 'eligibility unavailable' } } : { data: eligible, error: null }
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(localAdapterConfig.eligibilityRequests).toHaveLength(1))
    await waitFor(() => expect(getLatest()?.memberV2Enabled).toBe(eligible === true))
    expect(localAdapterConfig.eligibilityRequests[0]).toEqual({ p_owner_id: 'owner-1' })
  })

  it('does not publish a late eligible response for the previous workspace', async () => {
    enableHostedBuild()
    let finishPilotCheck
    localAdapterConfig.eligibility = async ({ p_owner_id }) => p_owner_id === 'owner-1'
      ? new Promise((resolve) => { finishPilotCheck = () => resolve({ data: true, error: null }) })
      : { data: false, error: null }
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(finishPilotCheck).toBeTypeOf('function'))
    testConfig.accessContext = { has_access: true, is_collaborator: true, owner_id: 'owner-2' }
    await act(async () => getLatest().checkCollaboratorStatus())
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-2'))
    await act(async () => finishPilotCheck())
    expect(getLatest().memberV2Enabled).toBe(false)
  })

  it('invalidates eligibility during an actor switch before access resolves', async () => {
    enableHostedBuild()
    localAdapterConfig.eligibility = async () => ({ data: true, error: null })
    const { getLatest, rerender } = await renderProbe()
    await waitFor(() => expect(getLatest()?.memberV2Enabled).toBe(true))
    testConfig.user = { id: 'actor-2', email: 'actor-2@local.invalid' }
    testConfig.authLoading = true
    rerender()
    expect(getLatest().memberV2Enabled).toBe(false)
    expect(localAdapterConfig.eligibilityRequests).toHaveLength(1)
  })

  it('ignores a superseded access lookup after switching workspaces', async () => {
    enableHostedBuild()
    localAdapterConfig.eligibility = async ({ p_owner_id }) => ({ data: p_owner_id === 'owner-1', error: null })
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.memberV2Enabled).toBe(true))
    let finishOldAccess
    testConfig.accessContext = () => new Promise((resolve) => { finishOldAccess = resolve })
    let oldLookup
    act(() => { oldLookup = getLatest().checkCollaboratorStatus() })
    testConfig.accessContext = { has_access: true, is_collaborator: true, owner_id: 'owner-2' }
    await act(async () => getLatest().checkCollaboratorStatus())
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-2'))
    await act(async () => {
      finishOldAccess({ data: { has_access: true, is_collaborator: false, owner_id: 'owner-1' }, error: null })
      await oldLookup
    })
    expect(getLatest().dataOwnerId).toBe('owner-2')
    expect(getLatest().memberV2Enabled).toBe(false)
  })

  it.each(['pendingChanges', 'failedChanges', 'conflicts'])('blocks legacy profile entry points when V2 eligibility is unavailable with %s', async (field) => {
    enableHostedBuild()
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-1'))
    updateMemberV2LocalFlowGuard({ userId: 'owner-1', ownerId: 'owner-1', syncState: { [field]: 1 } })
    expect(getLatest().memberV2Enabled).toBe(false)
    await expect(getLatest().addMember({ full_name: 'Guarded' })).rejects.toThrow(/unsynced local work/i)
    await expect(getLatest().updateMember('m1', { 'Full Name': 'Guarded' })).rejects.toThrow(/unsynced local work/i)
    await expect(getLatest().deleteMember('m1')).rejects.toThrow(/unsynced local work/i)
    expect(getLatest().members).toEqual([])
  })

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

  it('loads members as soon as a refreshed session becomes available', async () => {
    testConfig.user = { id: 'owner-1', email: 'owner@example.com' }
    testConfig.session = { user: { id: 'owner-1' } }
    testConfig.rangeResult = {
      data: [{ id: 'm1', name: 'Ama', phone: '111', deleted_at: null, updated_at: '2026-08-10T00:00:00Z' }],
      error: null
    }
    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('HYDRATED'))
    expect(getLatest()?.members?.map((member) => member.id)).toContain('m1')
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

  it('does not let a late full snapshot for the previous month replace the active month', async () => {
    const augustId = 'synthetic-august-member'
    const januaryId = 'synthetic-january-member'
    let resolveJanuarySnapshot
    let deferJanuarySnapshot = false
    testConfig.rangeResultForTable = (table, from) => {
      if (table === 'January_2026' && from === 0 && deferJanuarySnapshot) {
        return new Promise((resolve) => { resolveJanuarySnapshot = () => resolve({ data: [{ id: januaryId, name: 'Synthetic', deleted_at: null }], error: null }) })
      }
      return { data: [{ id: augustId, name: 'Synthetic', deleted_at: null }], error: null }
    }

    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.currentTable).toBe('August_2026'))
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain(augustId))

    await getLatest().setCurrentTable('January_2026')
    await waitFor(() => expect(getLatest()?.currentTable).toBe('January_2026'))
    deferJanuarySnapshot = true
    const pendingSnapshot = getLatest().fetchMembers('January_2026', { fullSnapshot: true, background: true })
    await waitFor(() => expect(resolveJanuarySnapshot).toBeTypeOf('function'))

    await getLatest().setCurrentTable('August_2026')
    await waitFor(() => expect(getLatest()?.currentTable).toBe('August_2026'))
    resolveJanuarySnapshot()
    await pendingSnapshot

    expect(getLatest()?.members?.map((member) => member.id)).toContain(augustId)
    expect(getLatest()?.members?.map((member) => member.id)).not.toContain(januaryId)
  })

  it('does not mark HYDRATED on a transient error that preserves an empty list', async () => {
    testConfig.rangeResult = { data: null, error: { message: 'network hiccup', code: 'NETWORK' } }
    const { getLatest } = await renderProbe()

    await waitFor(() => expect(getLatest()).toBeTruthy())
    // Give any stale background resolution a chance to settle, then confirm the
    // error path never reported hydrated (a transient error must not show empty).
    expect(getLatest().memberHydrationState).not.toBe('HYDRATED')
  })

  it('ignores a late offline Member V2 projection after the active month changes', async () => {
    localStorage.setItem('datser_offline_mode', 'offline')
    let resolveAugust
    localAdapterConfig.listLocalMembers = async ({ tableName } = {}) => {
      if (!tableName) return []
      if (tableName === 'August_2026') return new Promise((resolve) => { resolveAugust = () => resolve([{ id: 'stale-august', name: 'Stale August', deleted_at: null }]) })
      return [{ id: 'current-january', name: 'Current January', deleted_at: null }]
    }
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(resolveAugust).toBeTypeOf('function'))

    await getLatest().setCurrentTable('January_2026')
    await waitFor(() => expect(getLatest()?.currentTable).toBe('January_2026'))
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain('current-january'))
    resolveAugust()
    await waitFor(() => expect(getLatest()?.loading).toBe(false))

    expect(getLatest()?.members?.map((member) => member.id)).toContain('current-january')
    expect(getLatest()?.members?.map((member) => member.id)).not.toContain('stale-august')
    expect(getLatest()?.memberHydrationState).toBe('HYDRATED')
  })

  it('ignores an offline snapshot that resolves after the same user switches workspace owners', async () => {
    const staleMemberId = 'owner-a-stale-snapshot'
    const currentMemberId = 'owner-b-current-snapshot'
    let resolveOwnerASnapshot
    let delayNextSnapshot = false
    localStorage.setItem('datser_offline_mode', 'offline')
    localAdapterConfig.offlineSnapshot = () => {
      if (delayNextSnapshot) {
        delayNextSnapshot = false
        return new Promise((resolve) => { resolveOwnerASnapshot = resolve })
      }
      return null
    }
    localAdapterConfig.listLocalMembers = async () => (
      testConfig.accessContext.owner_id === 'owner-2'
        ? [{ id: currentMemberId, name: 'Owner B member', deleted_at: null }]
        : []
    )

    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-1'))
    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('OFFLINE_UNAVAILABLE'))
    delayNextSnapshot = true
    const staleFetch = getLatest().fetchMembers('August_2026', { background: true })
    await waitFor(() => expect(resolveOwnerASnapshot).toBeTypeOf('function'))

    testConfig.accessContext = { has_access: true, is_collaborator: true, is_admin_collaborator: false, owner_id: 'owner-2' }
    await getLatest().checkCollaboratorStatus()
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-2'))
    localAdapterConfig.offlineSnapshot = async () => null
    await getLatest().fetchMembers('August_2026')
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain(currentMemberId))
    const currentHydration = {
      table: getLatest()?.currentTable,
      members: getLatest()?.members?.map((member) => member.id),
      loading: getLatest()?.loading,
      hydration: getLatest()?.memberHydrationState,
      offlineStatus: getLatest()?.offlineStatusMessage,
    }

    resolveOwnerASnapshot({ snapshot: {
      authenticated_user_id: 'owner-1',
      data_owner_id: 'owner-1',
      is_collaborator: false,
      currentTable: 'August_2026',
      members: [{ id: staleMemberId, name: 'Owner A member' }],
      monthlyTables: [{ table_name: 'August_2026' }],
    } })
    await staleFetch
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getLatest()?.dataOwnerId).toBe('owner-2')
    expect(getLatest()?.currentTable).toBe(currentHydration.table)
    expect(getLatest()?.members?.map((member) => member.id)).toEqual(currentHydration.members)
    expect(getLatest()?.loading).toBe(currentHydration.loading)
    expect(getLatest()?.memberHydrationState).toBe(currentHydration.hydration)
    expect(getLatest()?.offlineStatusMessage).toBe(currentHydration.offlineStatus)
    expect(getLatest()?.members?.map((member) => member.id)).not.toContain(staleMemberId)
  })

  it.each(['resolve', 'reject'])('ignores an offline local read that completes with %s after the same user switches owners', async (outcome) => {
    let finishOwnerARead
    let delayNextOwnerARead = false
    localStorage.setItem('datser_offline_mode', 'offline')
    localAdapterConfig.offlineSnapshot = async () => null
    localAdapterConfig.listLocalMembers = async ({ ownerId }) => {
      if (ownerId === 'owner-2') return [{ id: 'owner-b-current-member', name: 'Owner B member', deleted_at: null }]
      if (delayNextOwnerARead) {
        delayNextOwnerARead = false
        return new Promise((resolve, reject) => {
          finishOwnerARead = () => outcome === 'resolve'
            ? resolve([{ id: 'owner-a-stale-member', name: 'Owner A member', deleted_at: null }])
            : reject(new Error('synthetic stale local read failure'))
        })
      }
      return []
    }

    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-1'))
    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('OFFLINE_UNAVAILABLE'))
    delayNextOwnerARead = true
    const staleFetch = getLatest().fetchMembers('August_2026')
    await waitFor(() => expect(finishOwnerARead).toBeTypeOf('function'))

    testConfig.accessContext = { has_access: true, is_collaborator: true, is_admin_collaborator: false, owner_id: 'owner-2' }
    await getLatest().checkCollaboratorStatus()
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-2'))
    await getLatest().fetchMembers('August_2026')
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain('owner-b-current-member'))
    const currentHydration = {
      table: getLatest()?.currentTable,
      members: getLatest()?.members?.map((member) => member.id),
      loading: getLatest()?.loading,
      hydration: getLatest()?.memberHydrationState,
      offlineStatus: getLatest()?.offlineStatusMessage,
    }

    finishOwnerARead()
    await staleFetch
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getLatest()?.members?.map((member) => member.id)).toEqual(currentHydration.members)
    expect(getLatest()?.members?.map((member) => member.id)).not.toContain('owner-a-stale-member')
    expect(getLatest()?.currentTable).toBe(currentHydration.table)
    expect(getLatest()?.loading).toBe(currentHydration.loading)
    expect(getLatest()?.memberHydrationState).toBe(currentHydration.hydration)
    expect(getLatest()?.offlineStatusMessage).toBe(currentHydration.offlineStatus)
    expect(getLatest()?.memberHydrationState).not.toBe('OFFLINE_UNAVAILABLE')
  }, 15000)

  it.each(['owner', 'table'])('rejects a transient-error snapshot with the wrong %s in the active request', async (mismatch) => {
    const currentMember = { id: 'current-scope-member', name: 'Current scope', deleted_at: null }
    testConfig.rangeResult = { data: [currentMember], error: null }
    testConfig.countResult = { count: 1, error: null }
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain(currentMember.id))
    await waitFor(() => expect(getLatest()?.loading).toBe(false))
    let snapshotReads = 0
    localAdapterConfig.offlineSnapshot = async () => {
      snapshotReads += 1
      return { snapshot: {
        authenticated_user_id: 'owner-1',
        data_owner_id: mismatch === 'owner' ? 'owner-2' : 'owner-1',
        currentTable: mismatch === 'table' ? 'January_2026' : 'August_2026',
        members: [{ id: 'wrong-scope-member', name: 'Wrong scope' }],
        monthlyTables: [{ table_name: 'January_2026' }],
      } }
    }
    testConfig.rangeResult = { data: null, error: { message: 'Failed to fetch', code: 'NETWORK' } }
    await getLatest().fetchMembers('August_2026', { forceRefresh: true, forceOnline: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(snapshotReads).toBeGreaterThan(0)
    expect(getLatest()?.currentTable).toBe('August_2026')
    expect(getLatest()?.members?.map((member) => member.id)).toEqual([currentMember.id])
    expect(getLatest()?.offlineStatusMessage).not.toBe('Offline Mode - using saved local data.')
  })

  it.each(['first-page', 'full-snapshot', 'rejected-full-snapshot'])('ignores an owner-A %s network result after owner B is active', async (kind) => {
    let finishOwnerARead
    let deferNextRead = false
    testConfig.rangeResultForTable = () => {
      if (deferNextRead) {
        deferNextRead = false
        return new Promise((resolve) => {
          finishOwnerARead = () => resolve(kind === 'rejected-full-snapshot'
            ? { data: null, error: { message: 'Failed to fetch', code: 'NETWORK' } }
            : { data: [{ id: 'stale-network-owner-a', name: 'Synthetic A' }], error: null })
        })
      }
      return { data: [{ id: testConfig.accessContext.owner_id === 'owner-2' ? 'current-network-owner-b' : 'initial-network-owner-a', name: 'Synthetic' }], error: null }
    }
    testConfig.countResult = { count: 1, error: null }
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain('initial-network-owner-a'))
    deferNextRead = true
    const staleFetch = getLatest().fetchMembers('August_2026', { forceRefresh: true, fullSnapshot: kind !== 'first-page' })
    await waitFor(() => expect(finishOwnerARead).toBeTypeOf('function'))
    testConfig.accessContext = { has_access: true, is_collaborator: true, is_admin_collaborator: false, owner_id: 'owner-2' }
    await getLatest().checkCollaboratorStatus()
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-2'))
    await getLatest().fetchMembers('August_2026', { forceRefresh: true })
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain('current-network-owner-b'))
    const current = {
      members: getLatest().members.map((member) => member.id),
      table: getLatest().currentTable,
      loading: getLatest().loading,
      hydration: getLatest().memberHydrationState,
      offlineStatus: getLatest().offlineStatusMessage,
    }
    finishOwnerARead()
    await staleFetch
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getLatest().members.map((member) => member.id)).toEqual(current.members)
    expect(getLatest().currentTable).toBe(current.table)
    expect(getLatest().loading).toBe(current.loading)
    expect(getLatest().memberHydrationState).toBe(current.hydration)
    expect(getLatest().offlineStatusMessage).toBe(current.offlineStatus)
  })

  it('does not restore a previous owner snapshot when the current owner enables offline mode', async () => {
    testConfig.rangeResult = { data: [{ id: 'online-current-member', name: 'Synthetic current' }], error: null }
    testConfig.countResult = { count: 1, error: null }
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain('online-current-member'))
    testConfig.accessContext = { has_access: true, is_collaborator: true, is_admin_collaborator: false, owner_id: 'owner-2' }
    await getLatest().checkCollaboratorStatus()
    await waitFor(() => expect(getLatest()?.dataOwnerId).toBe('owner-2'))
    await getLatest().fetchMembers(getLatest().currentTable, { forceRefresh: true })
    const currentTable = getLatest().currentTable
    localAdapterConfig.offlineSnapshot = async () => ({ snapshot: {
      authenticated_user_id: 'owner-1', data_owner_id: 'owner-1', currentTable: 'March_2026',
      members: [{ id: 'previous-owner-cache', name: 'Synthetic previous' }], monthlyTables: [{ table_name: 'March_2026' }],
    } })
    localAdapterConfig.listLocalMembers = async ({ ownerId }) => ownerId === 'owner-2'
      ? [{ id: 'offline-current-owner-b', name: 'Synthetic B' }] : []
    getLatest().setOfflineMode('offline')
    await waitFor(() => expect(getLatest()?.offlineMode).toBe('offline'))
    await getLatest().fetchMembers(getLatest().currentTable)
    await waitFor(() => expect(getLatest()?.members?.map((member) => member.id)).toContain('offline-current-owner-b'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getLatest()?.dataOwnerId).toBe('owner-2')
    expect(getLatest()?.currentTable).toBe(currentTable)
    expect(getLatest()?.members?.map((member) => member.id)).not.toContain('previous-owner-cache')
    await getLatest().refreshOfflineStatus()
    await waitFor(() => expect(getLatest()?.offlineCacheMeta).toBeNull())
  })

  it('finishes hydration with an explicit unavailable state when forced offline with no cached members', async () => {
    localStorage.setItem('datser_offline_mode', 'offline')
    localAdapterConfig.listLocalMembers = async () => []
    const { getLatest } = await renderProbe()
    await waitFor(() => expect(getLatest()?.memberHydrationState).toBe('OFFLINE_UNAVAILABLE'))
    expect(getLatest()?.loading).toBe(false)
    expect(getLatest()?.members || []).toEqual([])
    expect(getLatest()?.offlineStatusMessage).toContain('not saved on this device')
  })
})
