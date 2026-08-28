// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'react-toastify'
import AppearanceSettingsSection from './AppearanceSettingsSection'

const renderAppearance = (props = {}) => render(
  <AppearanceSettingsSection
    themeMode="system"
    setThemeMode={vi.fn()}
    preferences={{ member_name_style: 'title' }}
    updatePreferences={vi.fn().mockResolvedValue(true)}
    isCollaborator={false}
    canManageWorkspace
    getSettingTargetClass={() => ''}
    {...props}
  />
)

describe('AppearanceSettingsSection member name style', () => {
  it('shows title style by default and saves a confirmed shared lower-style preference', async () => {
    const updatePreferences = vi.fn().mockResolvedValue(true)
    renderAppearance({ updatePreferences })

    expect(screen.getByText('John Edem Adae').closest('button')?.className).toContain('bg-emerald-600')
    fireEvent.click(screen.getByText('john edem adae'))
    await Promise.resolve()
    expect(updatePreferences).toHaveBeenCalledWith({ member_name_style: 'lower' }, { silent: true })
  })

  it('keeps the confirmed style and shows one error when the server rejects a change', async () => {
    const updatePreferences = vi.fn().mockResolvedValue(false)
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => {})
    renderAppearance({ updatePreferences })

    fireEvent.click(screen.getAllByText('JOHN EDEM ADAE').at(-1))
    await Promise.resolve()

    expect(updatePreferences).toHaveBeenCalledWith({ member_name_style: 'upper' }, { silent: true })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('keeps the workspace control read-only for a non-admin collaborator', () => {
    renderAppearance({ canManageWorkspace: false, isCollaborator: true })
    const upperButton = screen.getAllByText('JOHN EDEM ADAE').at(-1)?.closest('button')
    expect(upperButton?.disabled).toBe(true)
    expect(screen.getAllByText(/Only the workspace owner or an admin collaborator/).length).toBeGreaterThan(0)
  })
})
