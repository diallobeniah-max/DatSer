// @vitest-environment jsdom
import React from 'react'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let appMock = null
let updateMemberMock = null
let onCloseMock = null
let rpcSpy = null

vi.mock('../context/AppContext', () => ({
  useApp: () => appMock
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false })
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1' },
    preferences: {},
    isDeveloperBypass: false
  })
}))

vi.mock('../lib/supabase', () => {
  const makeRpc = async (name, args) => {
    if (rpcSpy) return rpcSpy(name, args)
    return { data: null, error: null }
  }
  return {
    supabase: {
      rpc: (name, args) => makeRpc(name, args),
      from: () => ({
        select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) })
      })
    }
  }
})

vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}))

vi.mock('../hooks/useHapticFeedback', () => ({
  default: () => ({
    selection: vi.fn(),
    success: vi.fn()
  })
}))

const makeAppMock = () => ({
  updateMember: updateMemberMock,
  markAttendance: vi.fn(async () => true),
  currentTable: 'January_2026',
  attendanceData: {},
  members: [
    {
      id: 'm-1',
      full_name: 'Test Member',
      'Full Name': 'Test Member',
      gender: 'Male',
      'Phone Number': '0551234567',
      age: '18',
      'Age': '18',
      current_level: 'SHS1',
      'Current Level': 'SHS1',
      date_of_birth: '2008-05-05',
      is_visitor: false
    }
  ],
  isCollaborator: true,
  dataOwnerId: 'owner-1',
  isSupabaseConfigured: () => true,
  guidedFormSettings: { showTagsField: false, showVisitorField: false, showNotesField: false },
  recordRecentMemberEdit: vi.fn(),
  refreshMemberPreviewById: vi.fn()
})

const MODAL_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  member: { id: 'm-1' },
  onTagsChange: vi.fn()
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const editNameAndSubmit = async (modalElement, value) => {
  render(modalElement)
  await wait(60)
  fireEvent.change(screen.getByTestId('edit-form-full-name'), { target: { value } })
  fireEvent.click(screen.getByTestId('edit-form-submit'))
}

describe('EditMemberModal offline fallback routing', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    }
    updateMemberMock = vi.fn(async (id, updates, options) => ({ id, ...updates }))
    onCloseMock = vi.fn()
    rpcSpy = null
    appMock = makeAppMock()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('routes a transient backend failure through the canonical updateMember queue path', async () => {
    const { default: EditMemberModal } = await import('./EditMemberModal')
    let bundleCalls = 0
    rpcSpy = vi.fn(async (name) => {
      if (name === 'update_member_bundle_resilient') bundleCalls += 1
      throw new Error('Service Unavailable')
    })

    await editNameAndSubmit(
      <EditMemberModal
        isOpen
        onClose={onCloseMock}
        member={{ id: 'm-1' }}
        onTagsChange={vi.fn()}
      />,
      'Test Member Edited'
    )
    await wait(2000)

    expect(bundleCalls).toBeGreaterThan(0)
    expect(updateMemberMock).toHaveBeenCalledTimes(1)
    const [id, updates, options] = updateMemberMock.mock.calls[0]
    expect(id).toBe('m-1')
    expect(updates).toMatchObject({ 'Full Name': 'Test Member Edited' })
    expect(options).toMatchObject({ targetTable: 'January_2026', ownerId: 'owner-1' })
    expect(onCloseMock).toHaveBeenCalled()
  })

  it('routes an offline (navigator offline) edit through the canonical updateMember queue path', async () => {
    const { default: EditMemberModal } = await import('./EditMemberModal')
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    rpcSpy = vi.fn(async () => {
      throw new Error('Failed to fetch')
    })

    await editNameAndSubmit(
      <EditMemberModal
        isOpen
        onClose={onCloseMock}
        member={{ id: 'm-1' }}
        onTagsChange={vi.fn()}
      />,
      'Test Member Offline Edit'
    )
    await wait(2000)

    expect(updateMemberMock).toHaveBeenCalledTimes(1)
    const [, updates, options] = updateMemberMock.mock.calls[0]
    expect(updates).toMatchObject({ 'Full Name': 'Test Member Offline Edit' })
    expect(options).toMatchObject({ targetTable: 'January_2026', ownerId: 'owner-1' })
    expect(onCloseMock).toHaveBeenCalled()
  })

  it('keeps showing an error for non-transient failures without queueing or closing', async () => {
    const { default: EditMemberModal } = await import('./EditMemberModal')
    rpcSpy = vi.fn(async () => {
      const error = new Error('Row-level security blocks this edit')
      error.code = '42501'
      throw error
    })

    await editNameAndSubmit(
      <EditMemberModal
        isOpen
        onClose={onCloseMock}
        member={{ id: 'm-1' }}
        onTagsChange={vi.fn()}
      />,
      'Should Not Queue'
    )
    await wait(2000)

    expect(updateMemberMock).not.toHaveBeenCalled()
    expect(onCloseMock).not.toHaveBeenCalled()
  })
})
