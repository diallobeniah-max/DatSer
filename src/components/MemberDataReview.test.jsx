// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MemberDataReview from './MemberDataReview'

const { appState, supabaseCalls } = vi.hoisted(() => ({
  appState: {},
  supabaseCalls: { from: 0, rpc: 0, insert: 0, update: 0, delete: 0, tables: [] }
}))

vi.mock('../context/AppContext', () => ({
  useApp: () => appState
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1' }, preferences: {} })
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false })
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      supabaseCalls.from += 1
      supabaseCalls.tables.push(table)
      const chain = {
        select: (cols) => {
          chain.cols = cols
          return chain
        },
        eq: () => chain,
        is: () => chain,
        then: (resolve) => resolve({ data: appState.rowsFor?.[table] || [], error: null })
      }
      return chain
    },
    rpc: () => { supabaseCalls.rpc += 1; return Promise.resolve({ data: null, error: null }) },
    insert: () => { supabaseCalls.insert += 1; return Promise.resolve({ data: null, error: null }) },
    update: () => { supabaseCalls.update += 1; return Promise.resolve({ data: null, error: null }) },
    delete: () => { supabaseCalls.delete += 1; return Promise.resolve({ data: null, error: null }) }
  }
}))

const OWNER_UUID = '11111111-1111-1111-1111-111111111111'

const row = (overrides = {}) => ({
  id: 'uuid-101',
  'Full Name': 'Beniah Opong',
  Gender: 'Male',
  'Phone Number': '0244307261',
  Age: '28',
  'Current Level': 'Tertiary',
  is_visitor: false,
  parent_name_1: 'Ama Opong',
  parent_phone_1: '0241117261',
  parent_name_2: '',
  parent_phone_2: '',
  notes: '',
  ministry: 'Youth',
  date_of_birth: '1998-04-01',
  member_code: 'B01',
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  user_id: OWNER_UUID,
  ...overrides
})

const buildAppState = (overrides = {}) => ({
  monthlyTables: ['January_2026', 'May_2026'],
  dataOwnerId: OWNER_UUID,
  user: { id: OWNER_UUID },
  isSupabaseConfigured: () => true,
  workspaceMemberCodeAssignments: {
    'uuid-101': { current_code: 'B01', legacy_code: 'B01', aliases: [] }
  },
  ...overrides
})

describe('MemberDataReview page', () => {
  beforeEach(() => {
    Object.assign(appState, buildAppState())
    appState.rowsFor = {
      January_2026: [
        row({ id: 'uuid-101' }),
        row({ id: 'uuid-202', 'Full Name': 'John Doe', 'Phone Number': '0249995555', member_code: 'J02' })
      ],
      May_2026: [row({ id: 'uuid-101', 'Full Name': 'Beniah Opong Diallo' })]
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('loads people grouped by canonical identity and opens the comparison view', async () => {
    render(<MemberDataReview onBack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Beniah Opong Diallo')).toBeTruthy()
    })
    // Same canonical id across months groups together; different ids stay separate.
    expect(screen.getByText('John Doe')).toBeTruthy()
    expect(screen.getByText('2 months · 2 records')).toBeTruthy()
    expect(screen.getByText('1 month · 1 record')).toBeTruthy()

    fireEvent.click(screen.getByText('Beniah Opong Diallo'))
    expect(screen.getByText('Recommended Profile')).toBeTruthy()
    expect(screen.getByText('Records by month')).toBeTruthy()
    expect(screen.getByText('Details combined through May 2026')).toBeTruthy()
  })

  it('performs zero mutation or write RPC calls while loading and reviewing', async () => {
    render(<MemberDataReview onBack={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Beniah Opong Diallo')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Beniah Opong Diallo'))
    expect(screen.getByText('Recommended Profile')).toBeTruthy()

    expect(supabaseCalls.from).toBeGreaterThan(0)
    expect(supabaseCalls.tables).toEqual(expect.arrayContaining(['January_2026', 'May_2026']))
    expect(supabaseCalls.rpc).toBe(0)
    expect(supabaseCalls.insert).toBe(0)
    expect(supabaseCalls.update).toBe(0)
    expect(supabaseCalls.delete).toBe(0)
  })

  it('descending sort toggle actually reverses the result order', async () => {
    // A fresh owner avoids the module-level review cache populated by earlier tests.
    const sortOwner = '99999999-9999-9999-9999-999999999999'
    appState.dataOwnerId = sortOwner
    appState.user = { id: sortOwner }
    appState.rowsFor = {
      January_2026: [
        row({ id: 'uuid-a', 'Full Name': 'Aba Tetteh', member_code: 'A01' }),
        row({ id: 'uuid-b', 'Full Name': 'Zara Smith', member_code: 'Z01' })
      ]
    }
    render(<MemberDataReview onBack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Aba Tetteh')).toBeTruthy()
      expect(screen.getByText('Zara Smith')).toBeTruthy()
    })

    const namesInOrder = () => screen.getAllByText(/Aba Tetteh|Zara Smith/).map((node) => node.textContent)

    // Name ascending is the default: Aba Tetteh before Zara Smith.
    expect(namesInOrder()).toEqual(['Aba Tetteh', 'Zara Smith'])

    // Toggle the sort direction to descending.
    fireEvent.click(screen.getByRole('button', { name: '↑' }))
    await waitFor(() => {
      expect(namesInOrder()).toEqual(['Zara Smith', 'Aba Tetteh'])
    })
    expect(screen.getByRole('button', { name: '↓' })).toBeTruthy()
  })
})
