import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractSheetWithQwen } from './qwenExtract.js'

let fetchMock

const okResponse = {
  choices: [
    {
      message: {
        content: '{"sheet":{"detected_headers":[],"attendance_dates":[]},"rows":[{"full_name":"Ama","phone_number":"0241111111","attendance":{},"confidence":0.9,"warnings":[]}],"warnings":[]}'
      }
    }
  ]
}

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchMock.mockRestore()
})

describe('extractSheetWithQwen', () => {
  it('normalizes a Qwen response into the DatSer extraction shape', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(okResponse) })
    const result = await extractSheetWithQwen({
      imageBytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      apiKey: 'sk-qwen-test-key-value'
    })
    expect(result.sheet).toBeTruthy()
    expect(result.rows[0].full_name).toBe('Ama')
    expect(result.rows[0].phone_number).toBe('0241111111')
    expect(result.metadata).toBeUndefined() // routing adds metadata, not the extractor
  })

  it('rejects a missing image payload', async () => {
    await expect(extractSheetWithQwen({ imageBytes: null, mimeType: 'image/jpeg', apiKey: 'sk-valid-key-1234' }))
      .rejects.toThrow('An image payload is required')
  })

  it('returns SERVER_NOT_CONFIGURED when no key is provided', async () => {
    await expect(extractSheetWithQwen({ imageBytes: new Uint8Array([1]), mimeType: 'image/jpeg', apiKey: '' }))
      .rejects.toMatchObject({ code: 'SERVER_NOT_CONFIGURED' })
  })

  it('maps an invalid key (401) to INVALID_API_KEY', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({ error: { message: 'InvalidApiKey' } }) })
    await expect(extractSheetWithQwen({ imageBytes: new Uint8Array([1]), mimeType: 'image/jpeg', apiKey: 'sk-invalid-key-1234' }))
      .rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('maps a 429 to RATE_LIMITED retryable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({ error: { message: 'rate limit' } }) })
    await expect(extractSheetWithQwen({ imageBytes: new Uint8Array([1]), mimeType: 'image/jpeg', apiKey: 'sk-ratelimit-key1' }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true })
  })

  it('throws a retryable timeout when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(extractSheetWithQwen({ imageBytes: new Uint8Array([1]), mimeType: 'image/jpeg', apiKey: 'sk-timeout-key-123' }))
      .rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true })
  })
})
