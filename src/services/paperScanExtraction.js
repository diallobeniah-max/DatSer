// Client-side bridge for Paper Scan Review extraction.
// The Gemini API key NEVER appears in this file, in the browser, or in any
// bundle. The key lives server-side only; this module just posts the image to
// the DatSer server endpoint and returns normalized results.

export const GEMINI_EXTRACT_ENDPOINT = '/api/gemini-extract'

import { MAX_SHEET_UPLOAD_BYTES } from '../utils/paperScanImage'

// Vercel rejects function payloads above ~4.5 MB before our handler runs. The
// fitted sheet is budgeted to MAX_SHEET_UPLOAD_BYTES; this gate also covers the
// JSON wrapper (~a few KB) and any caller that bypasses fitting, so the browser
// never sends a body Vercel would drop. Direct callers get a friendly error
// instead of a confusing 413.
export const MAX_VERCEL_SAFE_BODY_BYTES = MAX_SHEET_UPLOAD_BYTES + 4096

const bodyByteLength = (body) => JSON.stringify(body).length

export const toExtractionRequest = ({ dataUrl, workspaceId, requestId }) => {
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || '')
  if (!match) {
    throw new Error('The sheet image could not be encoded.')
  }
  return {
    requestId,
    image: {
      mimeType: match[1],
      data: match[2]
    }
  }
}

const ERROR_MESSAGES = {
  AUTH_REQUIRED: 'Sign in before using Paper Scan Review.',
  SESSION_INVALID: 'Your sign-in session expired. Sign in again and retry.',
  AUTH_UNAVAILABLE: 'Could not verify your sign-in right now. Try again shortly.',
  WORKSPACE_NOT_AUTHORIZED: 'Your account does not have access to this workspace. Sign out and sign in again.',
  WORKSPACE_CHECK_UNAVAILABLE: 'Could not verify workspace access right now. Try again shortly.',
  QUOTA_UNAVAILABLE: 'Extraction safeguards are temporarily unavailable. Try again shortly.',
  DUPLICATE_REQUEST: 'This extraction attempt was already submitted. Retry the sheet once more if you want a fresh extraction.',
  DUPLICATE_IMAGE: 'This sheet was already extracted moments ago. Skip the duplicate or upload it again.',
  QUOTA_EXCEEDED: 'You have reached the extraction limit for this hour. Try again later.',
  IMAGE_TOO_SMALL: 'That image is too small to scan a sheet.',
  IMAGE_DIMENSIONS_INVALID: 'That image is too large to process.',
  DIMENSIONS_UNREADABLE: 'That image could not be verified as a photo. Try a clearer capture.',
  INVALID_IMAGE_DATA: 'That file is not a valid image.'
}

const makeError = (message, retryable) => {
  const error = new Error(message)
  if (retryable) error.retryable = true
  return error
}

export const parseExtractionResponse = async (response) => {
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('The extraction server returned an unreadable response.')
  }
  if (!response.ok || !payload?.ok) {
    const message = ERROR_MESSAGES[payload?.code] || payload?.error || 'Extraction failed.'
    const code = payload?.code
    const retryable = payload?.retryable === true
    if (code === 'RATE_LIMITED') throw makeError('Gemini is rate limited right now. Try again shortly.', retryable)
    if (code === 'PROVIDER_TIMEOUT') throw makeError('Gemini took too long to respond. Try again.', retryable)
    if (code === 'INVALID_API_KEY' || code === 'SERVER_NOT_CONFIGURED') {
      throw makeError('The server is not configured for Gemini extraction yet.', retryable)
    }
    if (code === 'IMAGE_TOO_LARGE') throw makeError('That image is too large to process.', retryable)
    if (code === 'MODEL_UNAVAILABLE') throw makeError('The Gemini model is temporarily unavailable.', retryable)
    if (code === 'MALFORMED_RESPONSE' || code === 'EMPTY_RESPONSE') {
      throw makeError('Gemini could not read this sheet cleanly. Try a clearer photo or different enhancement.', retryable)
    }
    if (code === 'GEMINI_API_ERROR') throw makeError('Gemini could not complete the request. Try again.', retryable)
    throw makeError(message, retryable)
  }
  return {
    sheet: payload.sheet || { detected_headers: [], attendance_dates: [] },
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    usageMetadata: payload?.usageMetadata || null
  }
}

export const extractSheetWithGemini = async ({ dataUrl, signal, workspaceId, requestId, bearerToken }) => {
  const body = toExtractionRequest({ dataUrl, workspaceId, requestId })
  if (bodyByteLength(body) > MAX_VERCEL_SAFE_BODY_BYTES) {
    throw new Error('That image is too large to upload. Try a smaller or clearer photo.')
  }
  const headers = { 'Content-Type': 'application/json' }
  if (workspaceId) headers['X-DatSer-Workspace-Id'] = workspaceId
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`
  let response
  try {
    response = await fetch(GEMINI_EXTRACT_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new Error('Could not reach the extraction server. Check your connection and try again.')
  }
  return parseExtractionResponse(response)
}