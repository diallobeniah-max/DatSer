// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OfflineStatusBanner from './OfflineStatusBanner'
import { setDurableOfflineSetupMeta, clearDurableOfflineSetupMeta, getDurableOfflineSetupMeta } from '../utils/offlineStore'

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

describe('OfflineStatusBanner durable completion check', () => {
  beforeEach(() => {
    if (typeof window.sessionStorage?.clear === 'function') window.sessionStorage.clear()
    clearDurableOfflineSetupMeta()
    appState = makeAppState()
  })

  afterEach(() => {
    cleanup()
    clearDurableOfflineSetupMeta()
    vi.clearAllMocks()
  })

  it('does NOT show setup prompt when durable offline setup is complete', () => {
    setDurableOfflineSetupMeta({
      snapshotComplete: true,
      memberCount: 50,
      tableCount: 12
    })

    render(<OfflineStatusBanner onOpenOfflineSettings={vi.fn()} />)
    expect(screen.queryByText('Set up offline access')).toBeNull()
  })
})
