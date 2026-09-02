// @vitest-environment jsdom
import React, { useEffect, useState } from 'react'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import MonthPickerPopup from '../components/MonthPickerPopup'

let authState = null
let savePersonalPreferencesMock = null

const createMemoryStorage = () => {
  let store = {}
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { store = {} },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length }
  }
}

vi.mock('../lib/supabase', () => {
  const makeQuery = (table) => {
    const base = {
      select: () => base,
      eq: () => base,
      in: () => base,
      limit: () => base,
      order: () => base,
      range: () => Promise.resolve({ data: [], error: null }),
      single: () => {
        if (table === 'collaborators') return Promise.resolve({ data: null, error: null })
        if (table === 'user_preferences') return Promise.resolve({ data: {}, error: null })
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
      on: (_event, filter, cb) => ch,
      subscribe: () => ch
    }
    return ch
  }
  return {
    supabase: {
      from: (table) => makeQuery(table),
      rpc: (name) => {
        if (name === 'get_available_month_tables') {
          return Promise.resolve({
            data: [{ table_name: 'August_2026' }, { table_name: 'January_2026' }, { table_name: 'February_2026' }],
            error: null
          })
        }
        if (name === 'get_table_columns') return Promise.resolve({ data: [], error: null })
        if (name === 'get_owner_locked_date') return Promise.resolve({ data: null, error: null })
        if (name === 'get_owner_workspace_name') return Promise.resolve({ data: 'Workspace', error: null })
        return Promise.resolve({ data: null, error: null })
      },
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'owner-1' } } } }) },
      channel,
      removeChannel: () => {}
    }
  }
})

vi.mock('./AuthContext', () => ({
  useAuth: () => authState
}))

// Real production wiring: the popup is hosted exactly as Header does, with
// onSelectSunday / onCalendarModeChange routed through AppContext's
// setPersonalCalendarMode.
const CalendarHost = () => {
  const { currentTable, setPersonalCalendarMode, isPersonalManualMode } = useHostApp()
  const [open, setOpen] = useState(true)
  return <>
    <output data-testid="applied-month">{currentTable}</output>
    <MonthPickerPopup
      isOpen={open}
      onClose={() => setOpen(false)}
      calendarMode={isPersonalManualMode ? 'manual' : 'auto'}
      onCalendarModeChange={(mode) => setPersonalCalendarMode({ mode })}
      onSelectSunday={({ table, date }) => setPersonalCalendarMode({ mode: 'manual', tableName: table, date })}
    />
  </>
}

import { AppProvider, useApp as useHostApp } from './AppContext'

describe('Manual calendar button must not auto-save (production wiring)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'test-key'
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')

    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true })
    }
    localStorage.clear()
    // Stale client history from a prior manual session survives.
    localStorage.setItem('selectedMonthTable', 'January_2026')
    localStorage.setItem('selectedAttendanceDate_January_2026', new Date(2026, 0, 4).toISOString())

    savePersonalPreferencesMock = vi.fn(async (patch) => {
      Object.assign(authState.personalPreferences, patch)
      return true
    })
    authState = {
      user: { id: 'owner-1', email: 'owner@example.com' },
      loading: false,
      personalPreferences: {
        calendar_mode: 'auto',
        manual_month_table: null,
        manual_sunday_date: null,
        manual_override_until: null,
        current_month_table: 'August_2026'
      },
      preferencesHydrated: true,
      preferencesLoading: false,
      preferencesError: null,
      get preferences() { return { ...this.personalPreferences } },
      savePersonalPreferences: savePersonalPreferencesMock,
      updatePreference: vi.fn()
    }
  })

  const renderHost = () => render(
    <AppProvider>
      <CalendarHost />
    </AppProvider>
  )

  it('clicking Manual alone performs zero saves (no stale manual write after timers advance)', async () => {
    renderHost()
    await waitFor(() => expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false), { timeout: 4000 })

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    expect(screen.getByRole('button', { name: 'manual' }).getAttribute('aria-pressed')).toBe('true')

    // Advance timers well past any scheduled callback/debounce (~20s).
    await vi.waitFor(() => expect(savePersonalPreferencesMock).toHaveBeenCalledTimes(0), { timeout: 100 })
    await new Promise((r) => setTimeout(r, 50))

    expect(savePersonalPreferencesMock).not.toHaveBeenCalled()
    expect(authState.personalPreferences.calendar_mode).toBe('auto')
    expect(authState.personalPreferences.manual_month_table).toBe(null)
    expect(authState.personalPreferences.manual_sunday_date).toBe(null)
  })

  it('clicking a month (preview) performs zero saves', async () => {
    renderHost()
    await waitFor(() => expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false), { timeout: 4000 })

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))
    await new Promise((r) => setTimeout(r, 50))

    expect(savePersonalPreferencesMock).not.toHaveBeenCalled()
  })

  it('keeps the applied month in place until Apply, then switches the month and Sunday together', async () => {
    renderHost()
    await waitFor(() => expect(screen.getByTestId('applied-month').textContent).toBe('August_2026'), { timeout: 4000 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false), { timeout: 4000 })

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))

    expect(screen.getByTestId('applied-month').textContent).toBe('August_2026')
    expect(savePersonalPreferencesMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply month' }))
    await waitFor(() => expect(screen.getByTestId('applied-month').textContent).toBe('January_2026'))
    expect(savePersonalPreferencesMock).toHaveBeenCalledTimes(1)
  })

  it('applies the drafted Manual month and Sunday exactly once', async () => {
    renderHost()
    await waitFor(() => expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false), { timeout: 4000 })

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))

    expect(savePersonalPreferencesMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply month' }))

    await vi.waitFor(() => expect(savePersonalPreferencesMock).toHaveBeenCalledTimes(1))
    expect(savePersonalPreferencesMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendar_mode: 'manual', manual_month_table: 'January_2026', manual_sunday_date: '2026-01-11' }),
      { requireServerConfirmation: true }
    )
  })
})
