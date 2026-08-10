// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useMemberDataReview from './useMemberDataReview'

const { appState, deferredQueue } = vi.hoisted(() => ({
  appState: {},
  deferredQueue: []
}))

vi.mock('../context/AppContext', () => ({
  useApp: () => appState
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-A' }, preferences: {} })
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false })
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        // A thenable: awaiting the chain invokes this on a microtask with the
        // await's internal resolvers. We record them so the test controls when
        // each request resolves.
        then: (resolve, reject) => {
          deferredQueue.push({ resolve, reject })
          return new Promise(() => {})
        }
      }
      return chain
    }
  }
}))

const row = (overrides = {}) => ({
  id: 'uuid-1',
  'Full Name': 'Person A',
  deleted_at: null,
  ...overrides
})

const OWNER_A1 = '11111111-1111-1111-1111-111111111111'
const OWNER_B1 = '22222222-2222-2222-2222-222222222222'
const OWNER_A2 = '33333333-3333-3333-3333-333333333333'
const OWNER_B2 = '44444444-4444-4444-4444-444444444444'

const buildAppState = (owner) => ({
  monthlyTables: ['January_2026'],
  dataOwnerId: owner,
  user: { id: owner },
  isSupabaseConfigured: () => true,
  workspaceMemberCodeAssignments: {}
})

const flush = async () => {
  await act(async () => { await Promise.resolve() })
}

describe('useMemberDataReview workspace-switch race', () => {
  beforeEach(() => {
    deferredQueue.length = 0
  })

  it('keeps the newest workspace result when an older request resolves last', async () => {
    Object.assign(appState, buildAppState(OWNER_A1))
    const { result, rerender } = renderHook(() => useMemberDataReview())

    // Request A begins for owner A.
    await flush()
    expect(deferredQueue.length).toBe(1)
    expect(result.current.status).toBe('loading')

    // Switch workspace to owner B; request B begins.
    Object.assign(appState, buildAppState(OWNER_B1))
    rerender()
    await flush()
    expect(deferredQueue.length).toBe(2)

    // B resolves first.
    act(() => { deferredQueue[1].resolve({ data: [row({ id: 'uuid-b', 'Full Name': 'Person B' })], error: null }) })
    await flush()
    expect(result.current.status).toBe('ready')
    expect(result.current.persons).toHaveLength(1)
    expect(result.current.persons[0].name).toBe('Person B')

    // Old A resolves afterward — it must be ignored.
    act(() => { deferredQueue[0].resolve({ data: [row({ id: 'uuid-a', 'Full Name': 'Person A' })], error: null }) })
    await flush()

    expect(result.current.persons[0].name).toBe('Person B')
    expect(result.current.status).toBe('ready')
  })

  it('ignores a stale error from an older workspace request', async () => {
    Object.assign(appState, buildAppState(OWNER_A2))
    const { result, rerender } = renderHook(() => useMemberDataReview())

    await flush()
    expect(deferredQueue.length).toBe(1)

    Object.assign(appState, buildAppState(OWNER_B2))
    rerender()
    await flush()
    expect(deferredQueue.length).toBe(2)

    act(() => { deferredQueue[1].resolve({ data: [row({ id: 'uuid-b', 'Full Name': 'Person B' })], error: null }) })
    await flush()
    expect(result.current.status).toBe('ready')

    // A stale rejection from the older owner must not overwrite B's state.
    act(() => { deferredQueue[0].reject(new Error('stale failure')) })
    await flush()

    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBeNull()
    expect(result.current.persons[0].name).toBe('Person B')
  })
})
