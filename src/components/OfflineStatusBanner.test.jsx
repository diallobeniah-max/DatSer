// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OfflineStatusBanner from './OfflineStatusBanner'

let appState

vi.mock('../context/AppContext', () => ({
  useApp: () => appState
}))

const makeAppState = (overrides = {}) => ({
  isOnline: true,
  offlineMode: 'auto',
  offlineModeStatus: 'online',
  offlineCacheMeta: null,
  pendingSyncCount: 0,
  offlineSaveNoticeThreshold: 10,
  offlineStatusMessage: '',
  isPreparingOffline: false,
  offlinePreparationProgress: null,
  isSyncingOffline: false,
  prepareOfflineData: vi.fn(),
  syncOfflineChanges: vi.fn(),
  hasAccess: true,
  ...overrides
})

const renderBanner = (props = {}) => render(<OfflineStatusBanner onOpenOfflineSettings={vi.fn()} {...props} />)

describe('OfflineStatusBanner setup dismissal', () => {
  beforeEach(() => {
    if (typeof window.sessionStorage?.clear === 'function') window.sessionStorage.clear()
    if (typeof window.localStorage?.clear === 'function') window.localStorage.clear()
    appState = makeAppState()
  })

  afterEach(() => {
    cleanup()
    if (typeof window.sessionStorage?.clear === 'function') window.sessionStorage.clear()
    if (typeof window.localStorage?.clear === 'function') window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('shows setup when an online workspace has not downloaded data', () => {
    renderBanner()
    expect(screen.getByRole('dialog', { name: 'Set up offline access' })).toBeTruthy()
  })

  it('closes immediately from X without starting a download or sync', () => {
    renderBanner()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss offline preparation prompt' }))

    expect(screen.queryByText('Set up offline access')).toBeNull()
    expect(appState.prepareOfflineData).not.toHaveBeenCalled()
    expect(appState.syncOfflineChanges).not.toHaveBeenCalled()
  })

  it('stays closed after a relevant context rerender in the same app session', () => {
    const view = renderBanner()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss offline preparation prompt' }))
    appState = makeAppState({ offlineCacheMeta: { completeness: 'partial' } })
    view.rerender(<OfflineStatusBanner onOpenOfflineSettings={vi.fn()} />)

    expect(screen.queryByText('Set up offline access')).toBeNull()
    expect(appState.prepareOfflineData).not.toHaveBeenCalled()
  })

  it('also dismisses from Escape without starting offline setup', () => {
    renderBanner()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByText('Set up offline access')).toBeNull()
    expect(appState.prepareOfflineData).not.toHaveBeenCalled()
  })

  it('can offer setup again in a new app session when no snapshot exists', () => {
    const firstSession = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss offline preparation prompt' }))
    firstSession.unmount()
    if (typeof window.sessionStorage?.clear === 'function') window.sessionStorage.clear()

    appState = makeAppState()
    renderBanner()

    expect(screen.getByRole('dialog', { name: 'Set up offline access' })).toBeTruthy()
  })
})
