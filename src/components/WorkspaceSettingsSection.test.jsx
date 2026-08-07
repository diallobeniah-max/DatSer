// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceSettingsSection from './WorkspaceSettingsSection'

afterEach(cleanup)

const renderSection = (overrides = {}) => {
  const props = {
    preferences: {},
    isCollaborator: false,
    isAdminCollaborator: false,
    currentTable: 'January_2026',
    selectedAttendanceDate: new Date(2026, 0, 11),
    lockedDefaultDate: null,
    monthlyTables: ['January_2026'],
    isOverrideSaving: false,
    handleEnableOverride: vi.fn(),
    handleDisableOverride: vi.fn(),
    isPersonalManualMode: false,
    manualMonthTable: null,
    manualSundayDate: null,
    personalModeDisabled: false,
    personalManualExpiryWarning: false,
    onOpenPersonalManualPicker: vi.fn(),
    onReturnToAuto: vi.fn(),
    onStayInManual: vi.fn(),
    toggleWorkspacePanel: vi.fn(),
    workspacePanels: { controls: true },
    getSettingTargetClass: () => '',
    setShowOverridePicker: vi.fn(),
    overrideButtonRef: { current: null },
    isLiveNow: true,
    getMonthDisplayName: (table) => table?.replace('_', ' ') || 'Unknown month',
    ...overrides
  }
  render(<WorkspaceSettingsSection {...props} />)
  return props
}

describe('WorkspaceSettingsSection calendar controls', () => {
  it('opens the personal Manual picker without persisting a preference', () => {
    const props = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))

    expect(props.onOpenPersonalManualPicker).toHaveBeenCalledOnce()
    expect(props.onReturnToAuto).not.toHaveBeenCalled()
  })

  it('opens the owner override picker before any workspace write', () => {
    const props = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    expect(props.handleEnableOverride).toHaveBeenCalledOnce()
    expect(props.handleDisableOverride).not.toHaveBeenCalled()
  })

  it('disables Manual for collaborators while an owner override is active', () => {
    renderSection({
      isCollaborator: true,
      lockedDefaultDate: '2026-01-11'
    })

    expect(screen.getByRole('button', { name: 'Manual' }).disabled).toBe(true)
    expect(screen.getByText('The workspace owner has locked the attendance date.')).toBeTruthy()
  })
})
