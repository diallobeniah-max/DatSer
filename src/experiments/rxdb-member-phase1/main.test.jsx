import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberV2Demo } from './main'
import { createMemberV2NetworkController } from './NetworkController'

describe('Member V2 harness bootstrap', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('renders a visible local-only configuration error instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<MemberV2Demo clientFactory={() => { throw new Error('missing local configuration') }} />)

    expect(screen.getByTestId('member-v2-poc-root')).not.toBeNull()
    expect(screen.getByTestId('member-v2-bootstrap-error').textContent).toContain('Start this local-only Vite harness')
    expect(screen.queryByRole('button', { name: 'Open local workspace' })).toBeNull()
  })

  it('renders the local Supabase sign-in surface when configured', () => {
    render(<MemberV2Demo clientFactory={() => ({ auth: { signInWithPassword: vi.fn() } })} />)

    expect(screen.getByTestId('member-v2-poc-root')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Open local workspace' })).not.toBeNull()
  })

  it('renders the DatSer-like local sign-in explanation', () => {
    render(<MemberV2Demo clientFactory={() => ({ auth: { signInWithPassword: vi.fn() } })} />)

    expect(screen.getByRole('heading', { name: 'Open synthetic local workspace' })).not.toBeNull()
    expect(screen.getByLabelText('Workspace owner UUID')).not.toBeNull()
  })

  it('persists simulated offline per browser session across a normal reload', () => {
    const values = new Map(); const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
    const firstLoad = createMemberV2NetworkController({ storage, browserOnlineCheck: () => true }); firstLoad.setSimulatedOffline(true)
    const reloaded = createMemberV2NetworkController({ storage, browserOnlineCheck: () => true })
    expect(reloaded.getState()).toBe('SIMULATED_OFFLINE'); expect(reloaded.isBackendReachable()).toBe(false)
  })
})
