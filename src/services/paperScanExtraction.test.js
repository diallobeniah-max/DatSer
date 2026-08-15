// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractSheetWithGemini,
  GEMINI_EXTRACT_ENDPOINT,
  parseExtractionResponse,
  toExtractionRequest
} from './paperScanExtraction'

const makeResponse = ({ ok, status, body }) => ({
  ok,
  status,
  json: async () => body
})

describe('toExtractionRequest', () => {
  it('parses a data URL into the wire payload with request id', () => {
    const req = toExtractionRequest({ dataUrl: 'data:image/png;base64,aGk=', workspaceId: 'wid-1', requestId: 'extract-1' })
    expect(req).toEqual({ requestId: 'extract-1', image: { mimeType: 'image/png', data: 'aGk=' } })
  })

  it('throws when the data URL is not an image', () => {
    expect(() => toExtractionRequest({ dataUrl: 'not-a-url', workspaceId: 'wid-1', requestId: 'x' })).toThrow(/could not be encoded/)
  })
})

describe('parseExtractionResponse', () => {
  it('returns the sheet, rows and warnings on success', async () => {
    const result = await parseExtractionResponse(makeResponse({
      ok: true,
      status: 200,
      body: { ok: true, sheet: { detected_headers: ['Name'], attendance_dates: [] }, rows: [{ full_name: 'A' }], warnings: ['dim'] }
    }))
    expect(result).toEqual({
      sheet: { detected_headers: ['Name'], attendance_dates: [] },
      rows: [{ full_name: 'A' }],
      warnings: ['dim'],
      usageMetadata: null
    })
  })

  it('passes Gemini usageMetadata through for saved-scan persistence', async () => {
    const result = await parseExtractionResponse(makeResponse({
      ok: true,
      status: 200,
      body: { ok: true, sheet: {}, rows: [], warnings: [], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }
    }))
    expect(result.usageMetadata).toEqual({ promptTokenCount: 5, candidatesTokenCount: 2 })
  })

  it('maps a duplicate request to a friendly message', async () => {
    const response = makeResponse({ ok: false, status: 409, body: { ok: false, code: 'DUPLICATE_REQUEST', error: 'dup' } })
    await expect(() => parseExtractionResponse(response)).rejects.toThrow('This extraction attempt was already submitted.')
  })

  it('maps quota exhaustion to a friendly message', async () => {
    const response = makeResponse({ ok: false, status: 429, body: { ok: false, code: 'QUOTA_EXCEEDED', error: 'limit' } })
    await expect(() => parseExtractionResponse(response)).rejects.toThrow('You have reached the extraction limit for this hour.')
  })

  it('flags transient failures as retryable so the UI can tell them apart', async () => {
    const response = makeResponse({
      ok: false,
      status: 429,
      body: { ok: false, code: 'RATE_LIMITED', error: 'rate limit', retryable: true }
    })
    await expect(() => parseExtractionResponse(response)).rejects.toSatisfy((error) => error.retryable === true)
  })

  it('leaves permanent failures without the retryable flag', async () => {
    const response = makeResponse({
      ok: false,
      status: 400,
      body: { ok: false, code: 'INVALID_IMAGE_DATA', error: 'bad image', retryable: false }
    })
    await expect(() => parseExtractionResponse(response)).rejects.toSatisfy((error) => error.retryable !== true)
  })

  it('maps a server-configuration failure to a clear message, not a raw provider error', async () => {
    const response = makeResponse({
      ok: false,
      status: 500,
      body: { ok: false, code: 'SERVER_NOT_CONFIGURED', error: 'The server is missing its Gemini API key.', retryable: false }
    })
    await expect(() => parseExtractionResponse(response)).rejects.toThrow('The server is not configured for Gemini extraction yet.')
  })

  it('maps a provider timeout to a clear retryable message', async () => {
    const response = makeResponse({
      ok: false,
      status: 504,
      body: { ok: false, code: 'PROVIDER_TIMEOUT', error: 'timed out', retryable: true }
    })
    const error = await parseExtractionResponse(response).catch((e) => e)
    expect(error.message).toContain('too long to respond')
    expect(error.retryable).toBe(true)
  })

  it('surfaces a generic provider failure without blaming the configuration', async () => {
    const response = makeResponse({
      ok: false,
      status: 502,
      body: { ok: false, code: 'GEMINI_API_ERROR', error: 'Gemini could not complete the request.', retryable: true }
    })
    await expect(() => parseExtractionResponse(response)).rejects.toThrow('Gemini could not complete the request.')
  })
})

describe('extractSheetWithGemini', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to the endpoint with the workspace header, request id, and caller signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({
      ok: true,
      status: 200,
      body: { ok: true, sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const result = await extractSheetWithGemini({
      dataUrl: 'data:image/webp;base64,aGVsbG8=',
      workspaceId: 'owner-workspace-id',
      requestId: 'extract-abc-123',
      bearerToken: 'tok',
      signal: controller.signal
    })
    expect(fetchMock).toHaveBeenCalledWith(GEMINI_EXTRACT_ENDPOINT, expect.objectContaining({
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-DatSer-Workspace-Id': 'owner-workspace-id',
        Authorization: 'Bearer tok'
      }
    }))
    const [ , init ] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      requestId: 'extract-abc-123',
      image: { mimeType: 'image/webp', data: 'aGVsbG8=' }
    })
    expect(result.rows).toEqual([])
  })

  it('omits the workspace header when none is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({
      ok: true,
      status: 200,
      body: { ok: true, sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] }
    }))
    vi.stubGlobal('fetch', fetchMock)
    await extractSheetWithGemini({ dataUrl: 'data:image/png;base64,aGk=', requestId: 'extract-1', signal: new AbortController().signal })
    const [ , init ] = fetchMock.mock.calls[0]
    expect(init.headers['X-DatSer-Workspace-Id']).toBeUndefined()
  })

  it('replays AbortError so aborted requests are never mistaken for failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(() => extractSheetWithGemini({
      dataUrl: 'data:image/png;base64,aGk=',
      requestId: 'extract-1',
      signal: new AbortController().signal
    })).rejects.toSatisfy((error) => error.name === 'AbortError')
  })

  it('wraps transport failures in a friendly connection message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network request failed'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(() => extractSheetWithGemini({
      dataUrl: 'data:image/png;base64,aGk=',
      requestId: 'extract-1',
      signal: new AbortController().signal
    })).rejects.toThrow('Could not reach the extraction server.')
  })

  it('refuses to send a body that would exceed the Vercel-safe upload budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({
      ok: true,
      status: 200,
      body: { ok: true, sheet: {}, rows: [], warnings: [] }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const oversizedBase64 = 'a'.repeat(3.6 * 1024 * 1024)
    await expect(() => extractSheetWithGemini({
      dataUrl: `data:image/jpeg;base64,${oversizedBase64}`,
      requestId: 'extract-1',
      signal: new AbortController().signal
    })).rejects.toThrow('That image is too large to upload. Try a smaller or clearer photo.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})