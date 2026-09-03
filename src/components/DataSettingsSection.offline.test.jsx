// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DataSettingsSection from './DataSettingsSection'

vi.mock('./SearchOtherMonthsSettingsSection', () => ({ default: () => <div /> }))
vi.mock('./OfflineSyncHealthSection', () => ({ default: () => <div /> }))

const renderSettings = (overrides = {}) => {
  const props = {
    offlineModeStatus: 'online',
    offlineMode: 'auto',
    setOfflineMode: vi.fn(),
    pendingSyncCount: 0,
    offlineCacheMeta: null,
    isPreparingOffline: false,
    offlinePreparationProgress: null,
    isSyncingOffline: false,
    prepareOfflineData: vi.fn(),
    syncOfflineChanges: vi.fn(),
    clearOfflineCacheData: vi.fn(),
    isOnline: true,
    dataOwnerId: 'workspace-a',
    offlinePendingChanges: [],
    monthlyTables: [],
    currentTable: null,
    members: [],
    setShowExportCenter: vi.fn(),
    setArchiveMonth: vi.fn(),
    getSettingTargetClass: () => '',
    openSettingsSection: vi.fn(),
    ...overrides
  }
  return { ...render(<DataSettingsSection {...props} />), props }
}

describe('DataSettingsSection offline access', () => {
  afterEach(() => vi.clearAllMocks())

  it('keeps offline setup available from Settings after the banner is dismissed', () => {
    const { props } = renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Download data' }))

    expect(props.prepareOfflineData).toHaveBeenCalledTimes(1)
  })
})
