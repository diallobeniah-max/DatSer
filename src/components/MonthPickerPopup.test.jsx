// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appState = {
  monthlyTables: ['January_2026', 'February_2026'],
  currentTable: 'February_2026',
  setCurrentTable: vi.fn(),
  isCollaborator: false,
  selectedAttendanceDate: new Date(2026, 1, 8),
  setAndSaveAttendanceDate: vi.fn(),
  getSundaysInMonth: (month, year) => {
    const monthIndex = month === 'January' ? 0 : 1
    return [new Date(year, monthIndex, monthIndex === 0 ? 11 : 8)]
  },
  ownerStickySundays: [],
  preferencesHydrated: true,
  preferencesLoading: false,
  preferencesError: null
}

vi.mock('../context/AppContext', () => ({
  useApp: () => appState
}))

vi.mock('../hooks/useHapticFeedback', () => ({
  default: () => ({ selection: vi.fn() })
}))

import MonthPickerPopup from './MonthPickerPopup'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  appState.preferencesHydrated = true
  appState.preferencesLoading = false
  appState.preferencesError = null
})

describe('MonthPickerPopup calendar mode', () => {
  it('keeps the primary create action visible in the responsive dialog shell', () => {
    render(<MonthPickerPopup isOpen onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Select Month' })
    expect(dialog.className).toMatch(/flex-col/)
    expect(dialog.className).toMatch(/w-\[calc\(100vw-1\.5rem\)\]/)
    expect(screen.getByRole('button', { name: 'Create New Month' })).toBeTruthy()
  })

  it('keeps the Manual Apply action full-width and tap-sized in the fixed footer', () => {
    render(
      <MonthPickerPopup
        isOpen
        onClose={vi.fn()}
        calendarMode="manual"
        onCalendarModeChange={vi.fn()}
        onSelectSunday={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Apply month' }).className).toMatch(/min-h-11.*w-full/)
  })

  it('keeps Manual choices as a draft, then saves once after Apply', async () => {
    const onSelectSunday = vi.fn().mockResolvedValue(true)
    const onCalendarModeChange = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={onClose}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    expect(onCalendarModeChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))
    expect(onSelectSunday).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))
    expect(onSelectSunday).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply month' }))
    await vi.waitFor(() => expect(onSelectSunday).toHaveBeenCalledTimes(1))
    expect(onSelectSunday).toHaveBeenCalledWith(expect.objectContaining({
      table: 'January_2026',
      dateStr: '2026-01-11'
    }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the picker open if the confirmed Manual save fails', async () => {
    const onSelectSunday = vi.fn().mockResolvedValue(false)
    const onClose = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={onClose}
        calendarMode="manual"
        onCalendarModeChange={vi.fn()}
        onSelectSunday={onSelectSunday}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply month' }))

    await vi.waitFor(() => expect(onSelectSunday).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('persists one explicit Auto change before closing a Manual calendar', async () => {
    const onCalendarModeChange = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={onClose}
        calendarMode="manual"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'auto' }))

    await vi.waitFor(() => expect(onCalendarModeChange).toHaveBeenCalledWith('auto'))
    expect(onCalendarModeChange).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('highlights the previewed month and unhighlights the confirmed month while Manual', () => {
    const onSelectSunday = vi.fn().mockResolvedValue(true)
    const onCalendarModeChange = vi.fn()
    // campaign currentTable maps to 'February_2026'; clicking January must
    // move the orange selection to January while February loses it.
    render(
      <MonthPickerPopup
        isOpen
        onClose={vi.fn()}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    expect(screen.getByRole('button', { name: 'Feb' }).className).toMatch(/bg-orange-500/)

    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))

    expect(screen.getByRole('button', { name: 'Jan' }).className).toMatch(/bg-orange-500/)
    expect(screen.getByRole('button', { name: 'Feb' }).className).not.toMatch(/bg-orange-500/)
    expect(onCalendarModeChange).not.toHaveBeenCalled()
    expect(onSelectSunday).not.toHaveBeenCalled()
  })

  it('shows the previewed month Sundays and applies that previewed month, not the confirmed one', async () => {
    const onSelectSunday = vi.fn().mockResolvedValue(true)
    const onCalendarModeChange = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={vi.fn()}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))

    expect(screen.getByRole('button', { name: 'Jan 11' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply month' }))

    await vi.waitFor(() => expect(onSelectSunday).toHaveBeenCalledTimes(1))
    expect(onSelectSunday).toHaveBeenCalledWith(expect.objectContaining({
      table: 'January_2026',
      dateStr: '2026-01-11'
    }))
  })

  it('cancelling before a Sunday keeps the confirmed table and makes no save', () => {
    const onSelectSunday = vi.fn()
    const onClose = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={onClose}
        calendarMode="auto"
        onCalendarModeChange={vi.fn()}
        onSelectSunday={onSelectSunday}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSelectSunday).not.toHaveBeenCalled()
    expect(appState.setCurrentTable).not.toHaveBeenCalled()
  })

  it('keeps the confirmed table untouched when the Manual save fails', async () => {
    const onSelectSunday = vi.fn().mockResolvedValue(false)
    const onClose = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={onClose}
        calendarMode="auto"
        onCalendarModeChange={vi.fn()}
        onSelectSunday={onSelectSunday}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply month' }))

    await vi.waitFor(() => expect(onSelectSunday).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
    expect(appState.setCurrentTable).not.toHaveBeenCalled()
  })

  it('keeps Manual controls usable while preferences refresh in the background', () => {
    appState.preferencesHydrated = false
    appState.preferencesLoading = true
    const onSelectSunday = vi.fn()
    const onCalendarModeChange = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={vi.fn()}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    expect(screen.getByText('Refreshing calendar settings in the background.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'auto' }).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Feb 8' }))
    expect(onCalendarModeChange).not.toHaveBeenCalled()
    expect(onSelectSunday).not.toHaveBeenCalled()
  })

  it('keeps controls usable when hydration fails, with a Retry action', async () => {
    appState.preferencesHydrated = false
    appState.preferencesError = 'Failed to load preferences'
    appState.retryPreferenceHydration = vi.fn().mockResolvedValue(true)
    const onSelectSunday = vi.fn()
    const onCalendarModeChange = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={vi.fn()}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Feb 8' }))
    expect(onCalendarModeChange).not.toHaveBeenCalled()
    expect(onSelectSunday).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(appState.retryPreferenceHydration).toHaveBeenCalledTimes(1))
  })

  it('enables the controls once hydration completes and allows one save', async () => {
    appState.preferencesHydrated = false
    appState.preferencesLoading = true
    const onSelectSunday = vi.fn().mockResolvedValue(true)
    const onCalendarModeChange = vi.fn()
    const popupProps = {
      isOpen: true,
      onClose: vi.fn(),
      calendarMode: 'auto',
      onCalendarModeChange,
      onSelectSunday
    }

    const view = render(<MonthPickerPopup {...popupProps} />)
    expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false)

    appState.preferencesHydrated = true
    appState.preferencesLoading = false
    view.rerender(<MonthPickerPopup {...popupProps} />)

    expect(screen.getByRole('button', { name: 'manual' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply month' }))

    await vi.waitFor(() => expect(onSelectSunday).toHaveBeenCalledTimes(1))
    expect(onSelectSunday).toHaveBeenCalledWith(expect.objectContaining({ table: 'January_2026' }))
  })

  it('rapid repeated Apply clicks produce exactly one onSelectSunday save', async () => {
    const onSelectSunday = vi.fn().mockResolvedValue(true)
    const onCalendarModeChange = vi.fn()

    render(
      <MonthPickerPopup
        isOpen
        onClose={vi.fn()}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }))

    fireEvent.click(screen.getByRole('button', { name: 'Jan 11' }))
    const apply = screen.getByRole('button', { name: 'Apply month' })
    fireEvent.click(apply)
    fireEvent.click(apply)
    fireEvent.click(apply)

    await vi.waitFor(() => expect(onSelectSunday).toHaveBeenCalledTimes(1))
    expect(onSelectSunday).toHaveBeenCalledWith(expect.objectContaining({ table: 'January_2026', dateStr: '2026-01-11' }))
  })

  it('reopening the popup does not issue any extra save', async () => {
    const onSelectSunday = vi.fn().mockResolvedValue(true)
    const onCalendarModeChange = vi.fn()
    const onClose = vi.fn()

    const view = render(
      <MonthPickerPopup
        isOpen
        onClose={onClose}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    view.rerender(
      <MonthPickerPopup
        isOpen={false}
        onClose={onClose}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )
    view.rerender(
      <MonthPickerPopup
        isOpen
        onClose={onClose}
        calendarMode="auto"
        onCalendarModeChange={onCalendarModeChange}
        onSelectSunday={onSelectSunday}
      />
    )

    expect(onSelectSunday).not.toHaveBeenCalled()
    expect(onCalendarModeChange).not.toHaveBeenCalled()
  })
})
