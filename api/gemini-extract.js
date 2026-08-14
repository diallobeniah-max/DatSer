import { extractSheetWithGemini, ExtractionError } from '../server/geminiExtract.js'
import { MAX_BODY_BYTES } from '../server/extractionErrors.js'
import { validateSheetImage } from '../server/imageValidation.js'
import {
  authenticateExtractionRequest,
  claimImageSlot,
  readBearerToken,
  readWorkspaceId
} from '../server/extractionGuard.js'

export const config = {
  runtime: 'nodejs20.x'
}

const send = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

const sendError = (res, error) => {
  const code = error instanceof ExtractionError ? error.code : 'EXTRACTION_FAILED'
  const message = error instanceof ExtractionError ? error.message : 'Extraction failed.'
  const status = error instanceof ExtractionError ? error.httpStatus : 502
  const retryable = error instanceof ExtractionError ? error.retryable === true : false
  send(res, status, { ok: false, error: message, code, retryable })
}

// Reads the body incrementally and stops accumulating the moment the byte
// limit is exceeded, so an oversized payload cannot buffer unbounded memory.
// The budget is compared against the received bytes (Buffer.byteLength, not
// string length: JSON text can be multi-byte), so the MAX_BODY_BYTES budget
// is enforced on the wire size, not on a looser character count. Returns an
// object without the raw image once the true JSON body has been parsed.
const readJsonBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
  return new Promise((resolve) => {
    let raw = ''
    let byteCount = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      raw += chunk
      byteCount += Buffer.byteLength(chunk)
      if (byteCount > MAX_BODY_BYTES) {
        tooLarge = true
        raw = ''
      }
    })
    req.on('end', () => {
      if (tooLarge) {
        resolve({ tooLarge: true })
        return
      }
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({ parseError: true })
      }
    })
    req.on('error', () => resolve({}))
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'Method not allowed' })
    return
  }

  // Authenticate BEFORE buffering the image: unauthenticated uploads must not
  // consume server memory. The workspace id travels in a header so it is
  // available before the body is read.
  let identity
  try {
    identity = await authenticateExtractionRequest({
      accessToken: readBearerToken(req),
      workspaceId: readWorkspaceId(req)
    })
  } catch (error) {
    sendError(res, error)
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    send(res, 400, { error: 'Invalid request body' })
    return
  }
  if (body?.tooLarge) {
    send(res, 413, { error: 'Payload too large' })
    return
  }
  if (body?.parseError) {
    send(res, 400, { error: 'Invalid JSON body' })
    return
  }
  const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : ''
  if (!requestId) {
    send(res, 400, { error: 'A request id is required.' })
    return
  }

  try {
    const image = validateSheetImage({
      mimeType: body?.image?.mimeType,
      data: body?.image?.data
    })

    // Atomic claim BEFORE Gemini: quota, idempotency and the ledger insert all
    // happen in one RPC transaction. A failed claim means no Gemini spend.
    const { extractionId } = await claimImageSlot({
      supabase: identity.supabase,
      user: identity.user,
      ownerId: identity.ownerId,
      sha256: image.sha256,
      requestId
    })

    const payload = await extractSheetWithGemini({
      imageBytes: image.bytes,
      mimeType: image.mimeType
    })

    send(res, 200, { ok: true, ...payload, ownerId: identity.ownerId, extractionId })
  } catch (error) {
    sendError(res, error)
  }
}