// @vitest-environment jsdom
import React, { useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

let preferenceListeners = []
let emitPreferencesChange = () => {}
let preferencesRow = null
let authState = null
let savePersonalPreferencesMock = null
let memberCodeOwnerFilter = null
let memberCodeRows = []

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
      select: () => base,
      eq: (col, val) => {
        if (table === 'workspace_member_codes' && col === 'workspace_owner_id') memberCodeOwnerFilter = val
        return base
      },
      in: () => base,
      limit: () => base,
      order: () => base,
      range: (from, pageSize) => {
        if (table === 'workspace_member_codes') {
          return Promise.resolve({ data: memberCodeRows.slice(from, from + pageSize), error: null })
        }
        return Promise.resolve({ data: [], error: null })
      },
      single: () => {
        if (table === 'collaborators') {
          return Promise.resolve({ data: { owner_id: 'owner-1', status: 'accepted' }, error: null })
        }
        if (table === 'user_preferences') return Promise.resolve({ data: preferencesRow, error: null })
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
        if (filter?.table === 'user_preferences') preferenceListeners.push(cb)
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
            data: [{ table_name: 'January_2026' }, { table_name: 'February_2026' }],
            error: null
          })
        }
        if (name === 'get_table_columns') return Promise.resolve({ data: [], error: null })
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

vi.mock('./AuthContext', () => ({
  useAuth: () => authState
}))

describe('AppContext member-code loading', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'test-key'
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')

    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true })
    }
    localStorage.clear()

    savePersonalPreferencesMock = vi.fn(async (patch) => {
      Object.assign(authState.personalPreferences, patch)
      return true
    })

    authState = {
      user: { id: 'collab-1', email: 'collab@example.com' },
      loading: false,
      personalPreferences: {},
      preferencesHydrated: true,
      preferencesLoading: false,
      preferencesError: null,
      get preferences() { return { ...this.personalPreferences } },
      savePersonalPreferences: savePersonalPreferencesMock,
      updatePreference: vi.fn()
    }
  })

  it('loads canonical member codes for the active workspace owner', async () => {
    memberCodeRows = [
      { member_id: 'uuid-100', current_code: 'A01', ordinal: 1, aliases: [], updated_at: '2026-08-01T10:00:00Z' },
      { member_id: 'uuid-101', current_code: 'A02', ordinal: 2, aliases: [], updated_at: '2026-08-01T10:00:00Z' }
    ]
    memberCodeOwnerFilter = null
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { workspaceMemberCodeAssignments, workspaceMemberCodeStatus, loadWorkspaceMemberCodes } = useApp()
      useEffect(() => {
        onState({ workspaceMemberCodeAssignments, workspaceMemberCodeStatus, loadWorkspaceMemberCodes })
      }, [workspaceMemberCodeAssignments, workspaceMemberCodeStatus, loadWorkspaceMemberCodes, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(typeof latest?.loadWorkspaceMemberCodes).toBe('function'), { timeout: 4000 })

    const assignments = await latest.loadWorkspaceMemberCodes()
    await waitFor(() => expect(latest?.workspaceMemberCodeStatus).toBe('ready'), { timeout: 4000 })

    expect(latest.workspaceMemberCodeAssignments['uuid-100']?.current_code).toBe('A01')
    expect(latest.workspaceMemberCodeAssignments['uuid-101']?.current_code).toBe('A02')
    expect(assignments.length).toBeGreaterThanOrEqual(2)
    expect(memberCodeOwnerFilter).toBeTruthy()
    unmount()
  })

  it('does not clear confirmed codes when the active month changes', async () => {
    memberCodeRows = [
      { member_id: 'uuid-100', current_code: 'A01', ordinal: 1, aliases: [], updated_at: '2026-08-01T10:00:00Z' }
    ]
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { workspaceMemberCodeAssignments, currentTable, loadWorkspaceMemberCodes } = useApp()
      useEffect(() => {
        onState({ workspaceMemberCodeAssignments, currentTable, loadWorkspaceMemberCodes })
      }, [workspaceMemberCodeAssignments, currentTable, loadWorkspaceMemberCodes, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(typeof latest?.loadWorkspaceMemberCodes).toBe('function'), { timeout: 4000 })
    await latest.loadWorkspaceMemberCodes()
    await waitFor(() => {
      expect(latest?.workspaceMemberCodeAssignments?.['uuid-100']?.current_code).toBe('A01')
    }, { timeout: 4000 })

    await waitFor(() => expect(preferenceListeners.length).toBeGreaterThan(0), { timeout: 4000 })
    emitPreferencesChange({
      admin_sticky_month: 'February_2026',
      admin_sticky_sundays: ['2026-02-08'],
      admin_sync_mode: 'banner'
    })

    await waitFor(() => expect(latest.currentTable).toBe('February_2026'), { timeout: 4000 })
    expect(latest.workspaceMemberCodeAssignments['uuid-100']?.current_code).toBe('A01')
    unmount()
  })

  it('does not save or change the month while preferences are still hydrating', async () => {
    authState.preferencesHydrated = false
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { currentTable, setPersonalCalendarMode } = useApp()
      useEffect(() => {
        onState({ currentTable, setPersonalCalendarMode })
      }, [currentTable, setPersonalCalendarMode, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(typeof latest?.setPersonalCalendarMode).toBe('function'), { timeout: 4000 })
    const before = latest.currentTable
    const saved = await latest.setPersonalCalendarMode({
      mode: 'manual',
      tableName: 'January_2026',
      date: new Date(2026, 0, 11)
    })

    expect(saved).toBe(false)
    expect(savePersonalPreferencesMock).not.toHaveBeenCalled()
    expect(latest.currentTable).toBe(before)
    unmount()
  })

  it('performs one confirmed save once hydration completes', async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { currentTable, setPersonalCalendarMode } = useApp()
      useEffect(() => {
        onState({ currentTable, setPersonalCalendarMode })
      }, [currentTable, setPersonalCalendarMode, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(typeof latest?.setPersonalCalendarMode).toBe('function'), { timeout: 4000 })
    const saved = await latest.setPersonalCalendarMode({
      mode: 'manual',
      tableName: 'January_2026',
      date: new Date(2026, 0, 11)
    })

    expect(saved).toBe(true)
    expect(savePersonalPreferencesMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(latest.currentTable).toBe('January_2026'), { timeout: 4000 })
    unmount()
  })

  it('coalesces concurrent duplicate Manual saves into a single RPC write', async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { setPersonalCalendarMode } = useApp()
      useEffect(() => {
        onState({ setPersonalCalendarMode })
      }, [setPersonalCalendarMode, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(typeof latest?.setPersonalCalendarMode).toBe('function'), { timeout: 4000 })

    const first = latest.setPersonalCalendarMode({
      mode: 'manual',
      tableName: 'January_2026',
      date: new Date(2026, 0, 11)
    })
    const second = latest.setPersonalCalendarMode({
      mode: 'manual',
      tableName: 'January_2026',
      date: new Date(2026, 0, 11)
    })

    const [r1, r2] = await Promise.all([first, second])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(savePersonalPreferencesMock).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('returns to Auto with exactly one save and clears the manual deadline', async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { setPersonalCalendarMode, isPersonalManualMode } = useApp()
      useEffect(() => {
        onState({ setPersonalCalendarMode, isPersonalManualMode })
      }, [setPersonalCalendarMode, isPersonalManualMode, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(typeof latest?.setPersonalCalendarMode).toBe('function'), { timeout: 4000 })

    await latest.setPersonalCalendarMode({ mode: 'manual', tableName: 'January_2026', date: new Date(2026, 0, 11) })
    expect(savePersonalPreferencesMock).toHaveBeenCalledTimes(1)

    const autoSaved = await latest.setPersonalCalendarMode({ mode: 'auto' })
    expect(autoSaved).toBe(true)
    expect(savePersonalPreferencesMock).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('refuses a bare Manual save without an explicit Sunday (no stale January write)', async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { setPersonalCalendarMode, currentTable } = useApp()
      useEffect(() => {
        onState({ setPersonalCalendarMode, currentTable })
      }, [setPersonalCalendarMode, currentTable, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(typeof latest?.setPersonalCalendarMode).toBe('function'), { timeout: 4000 })
    const before = authState.personalPreferences.calendar_mode
    const saved = await latest.setPersonalCalendarMode({ mode: 'manual' })

    expect(saved).toBe(false)
    expect(savePersonalPreferencesMock).not.toHaveBeenCalled()
    expect(authState.personalPreferences.calendar_mode).toBe(before)
    unmount()
  })
})
