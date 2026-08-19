// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPanel from './AdminPanel'

const mockSetCurrentView = vi.fn()

let mockAppState = {
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

let mockAuthUser = { id: 'owner-uuid', email: 'test@example.com', app_metadata: {} }

vi.mock('../context/AppContext', () => ({
  useApp: () => mockAppState
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser,
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

describe('AdminPanel navigation and maintenance tools', () => {
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
    mockAuthUser = { id: 'owner-uuid', email: 'test@example.com', app_metadata: {} }
  })

  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it('renders normal Admin header with Back, Overview, Member Data Review, and Scan Document', () => {
    render(<AdminPanel setCurrentView={mockSetCurrentView} />)

    expect(screen.getByTitle('Back to Dashboard')).toBeDefined()
    expect(screen.getByTitle('Overview')).toBeDefined()
    expect(screen.getByText('Member Data Review')).toBeDefined()
    expect(screen.getByTestId('admin-header-scan-document')).toBeDefined()

    // Historic Reconciliation must NOT be in the normal header
    expect(screen.queryByTitle('Operator-only historic member workspace reconciliation')).toBeNull()
    expect(screen.queryByTestId('admin-maintenance-tools')).toBeNull()
  })

  it('opens Admin directly from an existing Google-authenticated DatSer session', () => {
    window.sessionStorage.removeItem('adminAuthenticated')
    render(<AdminPanel setCurrentView={mockSetCurrentView} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))

    expect(window.sessionStorage.getItem('adminAuthenticated')).toBe('true')
    expect(screen.getByTestId('admin-header-scan-document')).toBeDefined()
  })

  it('renders prominent Scan Document card and routes to paper-scan-review', () => {
    render(<AdminPanel setCurrentView={mockSetCurrentView} />)

    const scanCard = screen.getByTestId('admin-scan-document-card')
    expect(scanCard).toBeDefined()
    expect(scanCard.textContent).toContain('Scan Document')
    expect(scanCard.textContent).toContain('Scan attendance sheets, review extracted data, choose months and Sundays, and save attendance.')

    const openScanBtn = screen.getByTestId('admin-open-scan-document')
    expect(openScanBtn.textContent).toContain('Open Scan')

    fireEvent.click(openScanBtn)
    expect(mockSetCurrentView).toHaveBeenCalledWith('paper-scan-review')
  })

  it('renders collapsed Maintenance Tools for operators and routes to reconciliation', () => {
    mockAuthUser = {
      id: 'owner-uuid',
      email: 'operator@example.com',
      app_metadata: { datser_provenance_operator: true }
    }

    render(<AdminPanel setCurrentView={mockSetCurrentView} />)

    // Normal header still does not have historic reconciliation
    expect(screen.queryByTitle('Operator-only historic member workspace reconciliation')).toBeNull()

    // Secondary Maintenance Tools section is rendered
    const maintenanceSection = screen.getByTestId('admin-maintenance-tools')
    expect(maintenanceSection).toBeDefined()
    expect(maintenanceSection.textContent).toContain('Maintenance Tools')
    expect(maintenanceSection.textContent).toContain('Historic Reconciliation')
    expect(maintenanceSection.textContent).toContain('Historic workspace ownership maintenance for legacy month records.')

    const openReconciliationBtn = screen.getByText('Open Historic Reconciliation')
    fireEvent.click(openReconciliationBtn)
    expect(mockSetCurrentView).toHaveBeenCalledWith('historic-provenance-reconciliation')
  })
})
