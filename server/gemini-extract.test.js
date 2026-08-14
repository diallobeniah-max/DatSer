import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtractionError, MAX_BODY_BYTES, MAX_IMAGE_BYTES } from './extractionErrors.js'
import handler from '../api/gemini-extract.js'

const mocks = vi.hoisted(() => ({
  extractSheetWithGemini: vi.fn(),
  validateSheetImage: vi.fn(),
  authenticateExtractionRequest: vi.fn(),
  claimImageSlot: vi.fn(),
  readBearerToken: vi.fn(),
  readWorkspaceId: vi.fn()
}))

vi.mock('./geminiExtract.js', async () => {
  const errors = await import('./extractionErrors.js')
  return {
    MAX_IMAGE_BYTES: errors.MAX_IMAGE_BYTES,
    ExtractionError: errors.ExtractionError,
    extractSheetWithGemini: mocks.extractSheetWithGemini
  }
})

vi.mock('./imageValidation.js', () => ({
  validateSheetImage: mocks.validateSheetImage
}))

vi.mock('./extractionGuard.js', () => ({
  authenticateExtractionRequest: mocks.authenticateExtractionRequest,
  claimImageSlot: mocks.claimImageSlot,
  readBearerToken: mocks.readBearerToken,
  readWorkspaceId: mocks.readWorkspaceId
}))

const OWNER = 'owner-workspace-id'
const SHA = 'a'.repeat(64)
const REQUEST_ID = 'extract-1-abc'
const IMAGE = { mimeType: 'image/png', data: 'aGVsbG8=' }

const callHandler = ({ method = 'POST', body = {}, headers = {} } = {}) => new Promise((resolve) => {
  const res = {
    statusCode: null,
    end: (raw) => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} })
  }
  res.setHeader = () => {}
  handler({ method, body, headers }, res)
})

// Exercises the incremental Readable-stream path (req.body undefined), which
// the object-based callHandler above never reaches.
const callHandlerWithStream = ({ method = 'POST', chunks = [], headers = {} } = {}) => new Promise((resolve) => {
  const req = new EventEmitter()
  req.method = method
  req.headers = headers
  const res = {
    statusCode: null,
    end: (raw) => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} })
  }
  res.setHeader = () => {}

  handler(req, res)

  setImmediate(() => {
    for (const chunk of chunks) {
      req.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    req.emit('end')
  })
})

describe('/api/gemini-extract serverless handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateExtractionRequest.mockResolvedValue({
      user: { id: 'caller-user-id' },
      ownerId: OWNER,
      supabase: {}
    })
    mocks.validateSheetImage.mockReturnValue({
      bytes: Buffer.from('hello'),
      mimeType: 'image/png',
      sha256: SHA
    })
    mocks.claimImageSlot.mockResolvedValue({ extractionId: 'claim-1-uuid' })
    mocks.extractSheetWithGemini.mockResolvedValue({
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      members: [{ line_number: 1, full_name: 'Kofi Mensah' }]
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('rejects non-POST methods with 405', async () => {
    const { status, body } = await callHandler({ method: 'GET' })
    expect(status).toBe(405)
    expect(body.error).toMatch(/method not allowed/i)
  })

  it('passes bearer token and workspace id to the extraction guard', async () => {
    mocks.readBearerToken.mockReturnValue('valid.bearer.jwt')
    mocks.readWorkspaceId.mockReturnValue(OWNER)

    const { status, body } = await callHandler({
      body: { requestId: REQUEST_ID, image: IMAGE }
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mocks.authenticateExtractionRequest).toHaveBeenCalledWith({
      accessToken: 'valid.bearer.jwt',
      workspaceId: OWNER
    })
  })

  it('propagates auth failures with guard error code without calling Gemini', async () => {
    mocks.authenticateExtractionRequest.mockRejectedValue(
      new ExtractionError('UNAUTHORIZED', 'Missing auth', 401)
    )

    const { status, body } = await callHandler({
      body: { requestId: REQUEST_ID, image: IMAGE }
    })

    expect(status).toBe(401)
    expect(body.code).toBe('UNAUTHORIZED')
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
  })

  it('rejects bodies with missing requestId before validation', async () => {
    const { status, body } = await callHandler({
      body: { image: IMAGE }
    })

    expect(status).toBe(400)
    expect(body.error).toMatch(/request id is required/i)
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('rejects image validation errors with correct HTTP status', async () => {
    mocks.validateSheetImage.mockImplementation(() => {
      throw new ExtractionError('IMAGE_TOO_LARGE', `Max is ${MAX_IMAGE_BYTES}`, 413)
    })

    const { status, body } = await callHandler({
      body: { requestId: REQUEST_ID, image: IMAGE }
    })

    expect(status).toBe(413)
    expect(body.code).toBe('IMAGE_TOO_LARGE')
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('aborts without Gemini call if image quota claim fails', async () => {
    mocks.claimImageSlot.mockRejectedValue(
      new ExtractionError('STORAGE_LIMIT_EXCEEDED', 'Limit reached', 429)
    )

    const { status, body } = await callHandler({
      body: { requestId: REQUEST_ID, image: IMAGE }
    })

    expect(status).toBe(429)
    expect(body.code).toBe('STORAGE_LIMIT_EXCEEDED')
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('returns 200 payload with extraction results and ledger id on success', async () => {
    const { status, body } = await callHandler({
      body: { requestId: REQUEST_ID, image: IMAGE }
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.extractionId).toBe('claim-1-uuid')
    expect(body.ownerId).toBe(OWNER)
    expect(body.members).toHaveLength(1)
    expect(body.members[0].full_name).toBe('Kofi Mensah')
  })

  it('converts Gemini extraction errors into structured error response', async () => {
    mocks.extractSheetWithGemini.mockRejectedValue(
      new ExtractionError('EXTRACTION_TIMEOUT', 'Timed out', 504, true)
    )

    const { status, body } = await callHandler({
      body: { requestId: REQUEST_ID, image: IMAGE }
    })

    expect(status).toBe(504)
    expect(body.code).toBe('EXTRACTION_TIMEOUT')
    expect(body.retryable).toBe(true)
  })

  it('reads chunked JSON streams when req.body is undefined', async () => {
    const json = JSON.stringify({ requestId: REQUEST_ID, image: IMAGE })
    const { status, body } = await callHandlerWithStream({
      chunks: [json.slice(0, 10), json.slice(10)]
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.extractionId).toBe('claim-1-uuid')
  })

  it('rejects oversized raw streams before parsing JSON with 413', async () => {
    // Stream chunks that exceed MAX_BODY_BYTES
    const chunk = 'a'.repeat(1024 * 1024)
    const chunks = []
    let total = 0
    while (total <= MAX_BODY_BYTES + 1024) {
      chunks.push(chunk)
      total += chunk.length
    }

    const { status, body } = await callHandlerWithStream({ chunks })
    expect(status).toBe(413)
    expect(body.error).toMatch(/payload too large/i)
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('rejects malformed raw JSON streams with 400', async () => {
    const { status, body } = await callHandlerWithStream({
      chunks: ['{ "requestId": "abc", broken json']
    })
    expect(status).toBe(400)
    expect(body.error).toMatch(/invalid json/i)
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })
})
