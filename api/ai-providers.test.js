import { describe, expect, it } from 'vitest'
import { classifyRpcError } from './ai-providers.js'

describe('ai-providers classifyRpcError', () => {
  it('maps a missing pgp function (42883) to STORAGE_UNAVAILABLE, never a bad-key hint', () => {
    const err = { message: 'function pgp_sym_encrypt(text,text) does not exist (code 42883)' }
    const mapped = classifyRpcError(err)
    expect(mapped.code).toBe('STORAGE_UNAVAILABLE')
    expect(mapped.httpStatus).toBe(503)
    expect(mapped.error).toContain('storage')
    expect(mapped.error).not.toContain('key')
  })

  it('maps an authorization error to FORBIDDEN 403', () => {
    const err = { message: 'permission denied for table ai_provider_credentials' }
    const mapped = classifyRpcError(err)
    expect(mapped.code).toBe('FORBIDDEN')
    expect(mapped.httpStatus).toBe(403)
  })

  it('maps an encryption-key config error to STORAGE_UNAVAILABLE without leaking internals', () => {
    const err = { message: 'Server encryption key is not configured (42501)' }
    const mapped = classifyRpcError(err)
    expect(mapped.code).toBe('STORAGE_UNAVAILABLE')
    expect(mapped.httpStatus).toBe(503)
    expect(mapped.error).not.toContain('encryption key is not')
  })

  it('falls back to a stable STORAGE_UNAVAILABLE for unknown DB errors', () => {
    const err = { message: 'connection timed out' }
    const mapped = classifyRpcError(err)
    expect(mapped.code).toBe('STORAGE_UNAVAILABLE')
    expect(mapped.httpStatus).toBe(503)
  })
})
