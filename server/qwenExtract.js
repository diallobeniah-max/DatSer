import { ExtractionError, MAX_IMAGE_BYTES } from './extractionErrors.js'
import {
  EXTRACTION_PROMPT,
  extractJsonText,
  normalizeExtraction,
  parseJsonLoose
} from './geminiExtract.js'

export { ExtractionError, MAX_IMAGE_BYTES }

export const QWEN_MODEL = 'qwen-vl-plus'
export const QWEN_API_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

const asString = (value) => (typeof value === 'string' ? value.trim() : '')

const toExtractionError = (error) => {
  if (error instanceof ExtractionError) return error
  const status = error?.status || error?.code
  const message = String(error?.message || 'Qwen request failed.')
  const isInvalidKey = /API_KEY_INVALID|InvalidApiKey|invalid api key|unauthorized/i.test(message) || status === 401
  const isRateLimited = status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit|throttl/i.test(message)
  const isModelUnavailable = status === 404 || /model.*not.*found|no such model|NOT_FOUND/i.test(message)
  const isTimeout = status === 504 || status === 408 || /DEADLINE_EXCEEDED|timed out|timeout|ETIMEDOUT/i.test(message)
  if (isInvalidKey) {
    return new ExtractionError('INVALID_API_KEY', 'The provider API key is rejected.', { httpStatus: 500 })
  }
  if (isRateLimited) {
    return new ExtractionError('RATE_LIMITED', 'Provider rate limit or quota reached.', { retryable: true, httpStatus: 429 })
  }
  if (isModelUnavailable) {
    return new ExtractionError('MODEL_UNAVAILABLE', 'The requested model is unavailable.', { httpStatus: 503 })
  }
  if (isTimeout) {
    return new ExtractionError('PROVIDER_TIMEOUT', 'The provider took too long to respond. Try again.', { retryable: true, httpStatus: 504 })
  }
  return new ExtractionError('GEMINI_API_ERROR', 'The provider could not complete the request.', { retryable: true, httpStatus: 502 })
}

// Qwen / Alibaba Cloud DashScope uses an OpenAI-compatible chat-completions
// endpoint. The image is sent as base64 inline data. The response is normalized
// to the SAME DatSer extraction shape as Gemini, so Paper Scan stays
// provider-agnostic.
export const extractSheetWithQwen = async ({
  imageBytes,
  mimeType,
  apiKey,
  model = QWEN_MODEL,
  apiBase = QWEN_API_BASE
}) => {
  if (!imageBytes || !(imageBytes instanceof Uint8Array) || imageBytes.length === 0) {
    throw new ExtractionError('MISSING_IMAGE', 'An image payload is required.', { httpStatus: 400 })
  }
  if (imageBytes.length > MAX_IMAGE_BYTES) {
    throw new ExtractionError('IMAGE_TOO_LARGE', 'The image is too large to process.', { httpStatus: 413 })
  }
  if (!apiKey || asString(apiKey).length < 10) {
    throw new ExtractionError('SERVER_NOT_CONFIGURED', 'The server is missing its provider API key.', { httpStatus: 500 })
  }
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${Buffer.from(imageBytes).toString('base64')}`

  let response
  try {
    response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        temperature: 0
      })
    })
  } catch (error) {
    throw new ExtractionError('PROVIDER_TIMEOUT', 'Could not reach the extraction provider. Try again.', { retryable: true, httpStatus: 504 })
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw toExtractionError({
      status: response.status,
      message: body?.error?.message || `HTTP ${response.status}`
    })
  }

  const body = await response.json().catch(() => null)
  if (!body) {
    throw new ExtractionError('EMPTY_RESPONSE', 'The provider returned no readable content.', { httpStatus: 502 })
  }

  const text = extractJsonText({
    candidates: body?.choices?.map((choice) => ({
      content: { parts: [{ text: choice?.message?.content || '' }] }
    })),
    text: body?.choices?.[0]?.message?.content || ''
  })
  if (!text) {
    throw new ExtractionError('EMPTY_RESPONSE', 'The provider returned no readable content.', { httpStatus: 502 })
  }
  const parsed = parseJsonLoose(text)
  if (!parsed) {
    throw new ExtractionError('MALFORMED_RESPONSE', 'The provider returned malformed JSON.', { httpStatus: 502 })
  }
  return {
    ...normalizeExtraction(parsed),
    usageMetadata: null
  }
}
