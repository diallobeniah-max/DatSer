import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtractionError, MAX_BODY_BYTES, MAX_IMAGE_BYTES } from '../server/extractionErrors.js'
import handler from './gemini-extract.js'

const mocks = vi.hoisted(() => ({
  extractSheetWithGemini: vi.fn(),
  validateSheetImage: vi.fn(),
  authenticateExtractionRequest: vi.fn(),
  claimImageSlot: vi.fn(),
  readBearerToken: vi.fn(),
  readWorkspaceId: vi.fn()
}))

vi.mock('../server/geminiExtract.js', async () => {
  const errors = await import('../server/extractionErrors.js')
  return {
    MAX_IMAGE_BYTES: errors.MAX_IMAGE_BYTES,
    ExtractionError: errors.ExtractionError,
    extractSheetWithGemini: mocks.extractSheetWithGemini
  }
})

vi.mock('../server/imageValidation.js', () => ({
  validateSheetImage: mocks.validateSheetImage
}))

vi.mock('../server/extractionGuard.js', () => ({
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
const callStreamHandler = (payload, { method = 'POST', headers = {} } = {}) => new Promise((resolve) => {
  const req = new EventEmitter()
  req.method = method
  req.headers = headers
  req.body = undefined
  const res = {
    statusCode: null,
    end: (raw) => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} })
  }
  res.setHeader = () => {}
  setTimeout(() => {
    req.emit('data', payload)
    req.emit('end')
  }, 20)
  handler(req, res)
})

describe('api/gemini-extract', () => {
  beforeEach(() => {
    mocks.readBearerToken.mockReturnValue('test-token')
    mocks.readWorkspaceId.mockReturnValue(OWNER)
    mocks.authenticateExtractionRequest.mockResolvedValue({ supabase: {}, user: { id: 'u' }, ownerId: OWNER })
    mocks.validateSheetImage.mockReturnValue({ bytes: Buffer.from('img'), mimeType: 'image/png', width: 100, height: 100, sha256: SHA })
    mocks.claimImageSlot.mockResolvedValue({ extractionId: 'extraction-1' })
    mocks.extractSheetWithGemini.mockResolvedValue({ sheet: {}, rows: [], warnings: [] })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-POST requests', async () => {
    const res = await callHandler({ method: 'GET' })
    expect(res.status).toBe(405)
  })

  it('authenticates BEFORE reading the payload so unauthenticated uploads never buffer a body', async () => {
    mocks.authenticateExtractionRequest.mockRejectedValue(
      new ExtractionError('AUTH_REQUIRED', 'Sign in before using Paper Scan Review.', { httpStatus: 401 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_REQUIRED')
    // The body contract must never reach validation, claim, or Gemini.
    expect(mocks.validateSheetImage).not.toHaveBeenCalled()
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not authorized for the workspace', async () => {
    mocks.authenticateExtractionRequest.mockRejectedValue(
      new ExtractionError('WORKSPACE_NOT_AUTHORIZED', 'denied', { httpStatus: 403 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID } })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('WORKSPACE_NOT_AUTHORIZED')
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
  })

  it('returns 403 for an anonymous identity and never calls Gemini', async () => {
    mocks.authenticateExtractionRequest.mockRejectedValue(
      new ExtractionError('ANONYMOUS_NOT_ALLOWED', 'Sign in with a full account to use Paper Scan Review.', { httpStatus: 403 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ANONYMOUS_NOT_ALLOWED')
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('rejects oversized payloads with 413 and never calls Gemini', async () => {
    const res = await callHandler({ body: { tooLarge: true } })
    expect(res.status).toBe(413)
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('enforces the body budget in received BYTES, not UTF-16 character count', async () => {
    // 7M multi-byte characters: character count (~7M) is well under
    // MAX_BODY_BYTES, but UTF-8 bytes (~21MB) exceed it. Only a byte-based
    // limit can reject this payload.
    const multiByte = '€'.repeat(7_000_000)
    const res = await callStreamHandler(multiByte)
    expect(res.status).toBe(413)
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('does not 413 a small payload on the stream path', async () => {
    const res = await callStreamHandler('{"requestId":"x","image":{}}')
    expect(res.status).toBe(200) // processed normally, no size rejection
  })

  it('rejects a missing request id before validation or extraction', async () => {
    const res = await callHandler({ body: { image: IMAGE } })
    expect(res.status).toBe(400)
    expect(mocks.validateSheetImage).not.toHaveBeenCalled()
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('rejects invalid images before reaching Gemini or claiming quota', async () => {
    mocks.validateSheetImage.mockImplementation(() => {
      throw new ExtractionError('INVALID_IMAGE_DATA', 'bad image', { httpStatus: 400 })
    })
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: { data: 'abc' } } })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_IMAGE_DATA')
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('returns 409 for a duplicate extraction attempt and never calls Gemini', async () => {
    mocks.claimImageSlot.mockRejectedValue(
      new ExtractionError('DUPLICATE_REQUEST', 'already submitted', { httpStatus: 409 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('DUPLICATE_REQUEST')
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('returns 429 when quota is exhausted and never calls Gemini', async () => {
    mocks.claimImageSlot.mockRejectedValue(
      new ExtractionError('QUOTA_EXCEEDED', 'limit reached', { httpStatus: 429 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(429)
    expect(res.body.code).toBe('QUOTA_EXCEEDED')
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the claim cannot be resolved and never calls Gemini', async () => {
    mocks.claimImageSlot.mockRejectedValue(
      new ExtractionError('QUOTA_UNAVAILABLE', 'safeguards down', { httpStatus: 503 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('QUOTA_UNAVAILABLE')
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('marks transient Gemini failures as retryable in the error payload', async () => {
    mocks.extractSheetWithGemini.mockRejectedValue(
      new ExtractionError('RATE_LIMITED', 'rate limited', { retryable: true, httpStatus: 429 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(429)
    expect(res.body.retryable).toBe(true)
  })

  it('keeps permanent failures non-retryable in the error payload', async () => {
    mocks.extractSheetWithGemini.mockRejectedValue(
      new ExtractionError('MALFORMED_RESPONSE', 'bad json', { httpStatus: 502 })
    )
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(502)
    expect(res.body.retryable).toBe(false)
  })

  it('authenticates from the header workspace, claims atomically, then extracts', async () => {
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(mocks.readWorkspaceId).toHaveBeenCalled()
    expect(mocks.authenticateExtractionRequest).toHaveBeenCalledWith({ accessToken: 'test-token', workspaceId: OWNER })
    expect(mocks.validateSheetImage).toHaveBeenCalledWith(IMAGE)
    expect(mocks.claimImageSlot).toHaveBeenCalledWith({
      supabase: {},
      user: { id: 'u' },
      ownerId: OWNER,
      sha256: SHA,
      requestId: REQUEST_ID
    })
    expect(mocks.extractSheetWithGemini).toHaveBeenCalledWith({ imageBytes: Buffer.from('img'), mimeType: 'image/png' })
    // The claim must finish before any Gemini spend.
    expect(mocks.claimImageSlot.mock.invocationCallOrder[0]).toBeLessThan(mocks.extractSheetWithGemini.mock.invocationCallOrder[0])
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.extractionId).toBe('extraction-1')
    expect(res.body.ownerId).toBe(OWNER)
  })

  it('forwards Gemini usageMetadata to the caller for later persistence', async () => {
    mocks.extractSheetWithGemini.mockResolvedValue({
      sheet: {},
      rows: [],
      warnings: [],
      usageMetadata: { promptTokenCount: 128, candidatesTokenCount: 64 }
    })
    const res = await callHandler({ body: { requestId: REQUEST_ID, image: IMAGE } })
    expect(res.status).toBe(200)
    expect(res.body.usageMetadata).toEqual({ promptTokenCount: 128, candidatesTokenCount: 64 })
  })

  it('rejects a malformed JSON body with 400', async () => {
    const res = await callHandler({ body: { parseError: true } })
    expect(res.status).toBe(400)
    expect(mocks.claimImageSlot).not.toHaveBeenCalled()
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
  })

  it('keeps the body budget tied to the shared maximum image size', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024)
    expect(MAX_BODY_BYTES).toBe(MAX_IMAGE_BYTES * 2)
  })
})