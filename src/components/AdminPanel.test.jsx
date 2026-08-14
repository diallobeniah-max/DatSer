// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPanel from './AdminPanel'

const mockSetCurrentView = vi.fn()

const mockAppState = {
  currentTable: 'August_2026',
  members: [
    { id: '1', 'Full Name': 'Alice Smith', attendance_2026_08_02: true },
    { id: '2', 'Full Name': 'Bob Jones', attendance_2026_08_02: false }
  ],
  availableTables: ['August_2026'],
  setCurrentView: mockSetCurrentView,
  canManageAppUpdates: false,
  canUseLocalApkBuilder: false,
  isProvenanceOperator: false,
  dataOwnerId: 'owner-uuid',
  isSupabaseConfigured: vi.fn(() => false),
  calculateAttendanceRate: vi.fn(() => 75),
  calculateSundayAttendance: vi.fn(() => ({ total: 2, present: 1, absent: 1, rate: 50 })),
  getTableSundays: vi.fn(() => ['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30']),
  attendanceFollowUps: { follow_up: [], inactive: [] },
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  addMember: vi.fn()
}

vi.mock('../context/AppContext', () => ({
  useApp: () => mockAppState
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-uuid', email: 'test@example.com' },
    preferences: {}
  })
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false })
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null })
        })
      })
    }),
    rpc: () => Promise.resolve({ data: null, error: null })
  }
}))

vi.mock('react-toastify', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn()
  }
}))

const createStorageMock = () => {
  let store = {}
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
    clear: () => { store = {} }
  }
}

describe('AdminPanel Scan Document entry points', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: createStorageMock(),
      writable: true
    })
    Object.defineProperty(window, 'sessionStorage', {
      value: createStorageMock(),
      writable: true
    })
    window.sessionStorage.setItem('adminAuthenticated', 'true')
    mockSetCurrentView.mockReset()
  })

  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it('renders prominent Scan Document card and routes to paper-scan-review', () => {
    render(<AdminPanel setCurrentView={mockSetCurrentView} />)

    // The primary action card must be present and display the exact text
    const scanCard = screen.getByTestId('admin-scan-document-card')
    expect(scanCard).toBeDefined()
    expect(scanCard.textContent).toContain('Scan Document')
    expect(scanCard.textContent).toContain('Scan attendance sheets, review extracted data, choose months and Sundays, and save attendance.')

    const openScanBtn = screen.getByTestId('admin-open-scan-document')
    expect(openScanBtn.textContent).toContain('Open Scan')

    fireEvent.click(openScanBtn)
    expect(mockSetCurrentView).toHaveBeenCalledWith('paper-scan-review')
  })

  it('renders header Scan Document button without hiding classes', () => {
    render(<AdminPanel setCurrentView={mockSetCurrentView} />)

    const headerBtn = screen.getByTestId('admin-header-scan-document')
    expect(headerBtn).toBeDefined()
    expect(headerBtn.textContent).toContain('Scan Document')

    // Ensure Member Data Review is also present separately
    expect(screen.getByText('Member Data Review')).toBeDefined()

    fireEvent.click(headerBtn)
    expect(mockSetCurrentView).toHaveBeenCalledWith('paper-scan-review')
  })
})
