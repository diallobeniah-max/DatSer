import React, { useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

let preferenceListeners = []
let emitPreferencesChange = () => {}
let preferencesRow = null

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
  preferenceListeners = []
  preferencesRow = {
    admin_sticky_month: 'January_2026',
    admin_sticky_sundays: [],
    locked_default_date: null,
    admin_sync_mode: 'banner'
  }
  emitPreferencesChange = (row) => {
    preferencesRow = {
      ...preferencesRow,
      ...row
    }
    preferenceListeners.forEach((cb) => cb({ new: preferencesRow }))
  }

  const makeQuery = (table) => {
    const base = {
      select: () => base,
      eq: () => base,
      in: () => base,
      limit: () => base,
      range: () => Promise.resolve({ data: [], error: null }),
      single: () => {
        if (table === 'collaborators') {
          return Promise.resolve({ data: { owner_id: 'owner-1', status: 'accepted' }, error: null })
        }
        if (table === 'user_preferences') {
          return Promise.resolve({
            data: preferencesRow,
            error: null
          })
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
  useAuth: () => ({
    user: { id: 'collab-1', email: 'collab@example.com' },
    loading: false,
    preferences: {},
    updatePreference: vi.fn()
  })
}))

describe('AppContext collaborator sync', () => {
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
  })

  it('auto-applies sticky month and sunday across month boundaries', async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { currentTable, selectedAttendanceDate, adminSyncNotice, acknowledgeAdminSync, isCollaborator } = useApp()
      useEffect(() => {
        onState({ currentTable, selectedAttendanceDate, adminSyncNotice, acknowledgeAdminSync, isCollaborator })
      }, [currentTable, selectedAttendanceDate, adminSyncNotice, acknowledgeAdminSync, isCollaborator, onState])
      return null
    }
    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe
          onState={(state) => {
            latest = state
          }}
        />
      </AppProvider>
    )

    await waitFor(() => {
      expect(latest?.currentTable).toBeTruthy()
    })

    await waitFor(() => {
      expect(latest.currentTable).toBe('January_2026')
    })

    await waitFor(() => {
      expect(latest.isCollaborator).toBe(true)
    })

    await waitFor(() => {
      expect(preferenceListeners.length).toBeGreaterThan(0)
    })

    emitPreferencesChange({
      admin_sticky_month: 'February_2026',
      admin_sticky_sundays: ['2026-02-08'],
      admin_sync_mode: 'banner'
    })

    await waitFor(() => {
      expect(latest.currentTable).toBe('February_2026')
    })

    await waitFor(() => {
      expect(latest.selectedAttendanceDate?.toISOString().slice(0, 10)).toBe('2026-02-08')
    })

    unmount()
  })

  it('keeps sticky month and picks sunday from that same month', async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { currentTable, selectedAttendanceDate, adminSyncNotice, acknowledgeAdminSync, isCollaborator } = useApp()
      useEffect(() => {
        onState({ currentTable, selectedAttendanceDate, adminSyncNotice, acknowledgeAdminSync, isCollaborator })
      }, [currentTable, selectedAttendanceDate, adminSyncNotice, acknowledgeAdminSync, isCollaborator, onState])
      return null
    }
    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe
          onState={(state) => {
            latest = state
          }}
        />
      </AppProvider>
    )

    await waitFor(() => {
      expect(latest?.isCollaborator).toBe(true)
    })

    await waitFor(() => {
      expect(preferenceListeners.length).toBeGreaterThan(0)
    })

    emitPreferencesChange({
      admin_sticky_month: 'January_2026',
      admin_sticky_sundays: ['2026-01-11'],
      admin_sync_mode: 'banner'
    })

    await waitFor(() => {
      expect(latest.currentTable).toBe('January_2026')
    })

    await waitFor(() => {
      expect(latest.selectedAttendanceDate?.toISOString().slice(0, 10)).toBe('2026-01-11')
    })

    unmount()
  })

  it('applies workspace tag visibility changes to an active collaborator in realtime', async () => {
    const { AppProvider, useApp } = await import('./AppContext.jsx')
    const StateProbe = ({ onState }) => {
      const { guidedFormSettings, isCollaborator } = useApp()
      useEffect(() => {
        onState({ guidedFormSettings, isCollaborator })
      }, [guidedFormSettings, isCollaborator, onState])
      return null
    }

    let latest = null
    const { unmount } = render(
      <AppProvider>
        <StateProbe onState={(state) => { latest = state }} />
      </AppProvider>
    )

    await waitFor(() => expect(latest?.isCollaborator).toBe(true))
    expect(latest.guidedFormSettings.showTagsField).toBe(false)

    emitPreferencesChange({
      guided_form_settings: {
        showTagsField: true,
        showVisitorField: false,
        showNotesField: false
      }
    })

    await waitFor(() => expect(latest.guidedFormSettings.showTagsField).toBe(true))
    unmount()
  })
})
