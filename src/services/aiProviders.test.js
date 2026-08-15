// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  AI_PROVIDERS_ENDPOINT,
  fetchProviderStatus,
  setProviderSecret,
  testProviderConnection,
  removeProviderSecret
} from './aiProviders'

const statusPayload = {
  ok: true,
  provider: 'gemini',
  configured: true,
  maskedSuffix: '7F3A',
  lastVerified: '2026-08-15T00:00:00.000Z',
  status: 'configured'
}

let fetchMock

const jsonResponse = (payload, ok = true, status = 200) => ({
  ok,
  status,
  json: () => Promise.resolve(payload)
})

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonResponse(statusPayload)))
})

afterEach(() => {
  fetchMock.mockRestore()
})

describe('aiProviders client service', () => {
  it('never reads a full API key from the status endpoint', async () => {
    const result = await fetchProviderStatus({ bearerToken: 'tok', workspaceId: 'owner-1', provider: 'gemini' })
    expect(result.maskedSuffix).toBe('7F3A')
    // The payload shape must never include the full secret.
    expect(JSON.stringify(result)).not.toMatch(/AIzaSy/)
    expect('secret' in result).toBe(false)
  })

  it('GET status uses the workspace header and auth header', async () => {
    await fetchProviderStatus({ bearerToken: 'tok-1', workspaceId: 'owner-1', provider: 'gemini' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('ownerId=owner-1')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    expect(init.headers['X-DatSer-Workspace-Id']).toBe('owner-1')
  })

  it('setProviderSecret sends the secret only to the server endpoint', async () => {
    await setProviderSecret({ bearerToken: 'tok', workspaceId: 'owner-1', provider: 'gemini', secret: 'AIzaSySomeKeyValue' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(AI_PROVIDERS_ENDPOINT)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.secret).toBe('AIzaSySomeKeyValue')
    expect(body.action).toBe('set')
  })

  it('throws on a non-ok status response', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: false, error: 'denied' }, false, 403)))
    await expect(fetchProviderStatus({ bearerToken: 'tok', workspaceId: 'owner-1' })).rejects.toThrow('denied')
  })

  it('testProviderConnection passes an optional secret for save-and-test', async () => {
    await testProviderConnection({ bearerToken: 'tok', workspaceId: 'owner-1', secret: 'AIzaSyTestKey' })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.action).toBe('test')
    expect(body.secret).toBe('AIzaSyTestKey')
  })

  it('removeProviderSecret issues a DELETE with the workspace owner', async () => {
    await removeProviderSecret({ bearerToken: 'tok', workspaceId: 'owner-1', provider: 'gemini' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(String(url)).toContain('ownerId=owner-1')
  })
})
