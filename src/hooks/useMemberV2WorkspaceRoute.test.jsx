// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMemberV2WorkspaceRoute } from './useMemberV2WorkspaceRoute'
import { assertLegacyMemberFlowIsSafe, updateMemberV2LocalFlowGuard } from '../experiments/rxdb-member-phase1/memberV2FeatureFlag'

const env = { PROD: true, VITE_DATSER_MEMBER_V2_HOSTED_ROLLOUT: 'true' }
const props = (client, overrides = {}) => ({ client, userId: 'actor', ownerId: 'pilot', workspace: 'owner-pilot', ready: true, online: true, env, ...overrides })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
afterEach(cleanup)

describe('hosted Member V2 workspace routing', () => {
  it('requires a positive server decision for the requested owner', async () => {
    const request = deferred()
    const client = { rpc: vi.fn(() => request.promise) }
    const { result } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client) })
    expect(result.current).toBe(false)
    expect(client.rpc).toHaveBeenCalledWith('member_v2_workspace_eligible', { p_owner_id: 'pilot' })
    await act(async () => request.resolve({ data: true, error: null }))
    expect(result.current).toBe(true)
  })

  it.each([
    { data: false, error: null },
    { data: null, error: null },
    { data: 'true', error: null },
    { data: true, error: { message: 'RPC unavailable' } },
  ])('keeps ineligible or invalid responses on legacy flow: %j', async (response) => {
    const client = { rpc: vi.fn(async () => response) }
    const { result } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client) })
    await act(async () => {})
    expect(result.current).toBe(false)
  })

  it('fails closed on a thrown eligibility failure', async () => {
    const client = { rpc: vi.fn(async () => { throw new Error('Failed to fetch') }) }
    const { result } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client) })
    await act(async () => {})
    expect(result.current).toBe(false)
  })

  it('does not query an unresolved owner or when rollout is disabled', () => {
    const client = { rpc: vi.fn() }
    const { result, rerender } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client, { ready: false }) })
    expect(result.current).toBe(false)
    rerender(props(client, { env: { PROD: true } }))
    expect(result.current).toBe(false)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('ignores a late pilot response after switching to a non-pilot owner', async () => {
    const request = deferred()
    const client = { rpc: vi.fn((_name, args) => args.p_owner_id === 'pilot' ? request.promise : Promise.resolve({ data: false })) }
    const { result, rerender } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client) })
    rerender(props(client, { ownerId: 'other', workspace: 'owner-other' }))
    await act(async () => request.resolve({ data: true }))
    expect(result.current).toBe(false)
  })

  it.each(['ownerId', 'userId', 'workspace'])('invalidates a confirmed pilot synchronously when %s changes', async (field) => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: true }).mockImplementation(() => new Promise(() => {})) }
    const { result, rerender } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client) })
    await waitFor(() => expect(result.current).toBe(true))
    rerender(props(client, { [field]: 'other' }))
    expect(result.current).toBe(false)
    rerender(props(client))
    expect(result.current).toBe(false)
  })

  it('retains only this session scope offline, rejects switches, and rechecks reconnect', async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: true }).mockResolvedValue({ data: false }) }
    const { result, rerender } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client, { online: false }) })
    expect(result.current).toBe(false)
    expect(client.rpc).not.toHaveBeenCalled()
    rerender(props(client))
    await waitFor(() => expect(result.current).toBe(true))
    rerender(props(client, { online: false }))
    expect(result.current).toBe(true)
    rerender(props(client, { online: false, ownerId: 'other', workspace: 'owner-other' }))
    expect(result.current).toBe(false)
    rerender(props(client, { online: false }))
    expect(result.current).toBe(false)
    rerender(props(client))
    await act(async () => {})
    expect(result.current).toBe(false)
  })

  it('discards responses arriving after going offline and on unmount', async () => {
    const request = deferred()
    const client = { rpc: vi.fn(() => request.promise) }
    const { result, rerender, unmount } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client) })
    rerender(props(client, { online: false }))
    await act(async () => request.resolve({ data: true }))
    expect(result.current).toBe(false)
    unmount()
  })

  it.each(['pendingChanges', 'failedChanges', 'conflicts'])('preserves the legacy guard when eligibility fails with %s', async (field) => {
    const values = new Map()
    const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
    updateMemberV2LocalFlowGuard({ userId: 'actor', ownerId: 'pilot', storage, syncState: { [field]: 1 } })
    const client = { rpc: vi.fn(async () => ({ data: false })) }
    const { result } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client) })
    await act(async () => {})
    expect(result.current).toBe(false)
    expect(() => assertLegacyMemberFlowIsSafe({ userId: 'actor', ownerId: 'pilot', storage })).toThrow(/unsynced local work/i)
    expect(() => assertLegacyMemberFlowIsSafe({ userId: 'actor', ownerId: 'other', storage })).not.toThrow()
  })

  it('preserves the explicit local validation route without hosted eligibility', () => {
    const client = { rpc: vi.fn() }
    const { result } = renderHook(useMemberV2WorkspaceRoute, { initialProps: props(client, { online: false, env: { DEV: true, VITE_DATSER_MEMBER_V2_SHARED_WEB_VALIDATION: 'true', VITE_SUPABASE_URL: 'http://127.0.0.1:54321' } }) })
    expect(result.current).toBe(true)
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
