import { GoogleGenAI } from '@google/genai'
import { getGeminiApiKey } from './geminiKey.js'
import { ExtractionError, MAX_IMAGE_BYTES } from './extractionErrors.js'

export { ExtractionError, MAX_IMAGE_BYTES } from './extractionErrors.js'

export const GEMINI_MODEL = 'gemini-3.1-flash-lite'

const EXTRACTION_PROMPT = `You are an attendance-sheet OCR assistant. Inspect the paper sheet image and return STRICT JSON only, matching exactly this schema:

{
  "sheet": {
    "detected_headers": [],
    "attendance_dates": [],
    "attendance_column_count": 0
  },
  "rows": [
    {
      "full_name": "",
      "phone_number": "",
      "gender": "",
      "age": "",
      "current_level": "",
      "attendance": { "1": { "mark": "tick", "status": "Present" } },
      "confidence": 0.0,
      "warnings": []
    }
  ],
  "warnings": []
}

Rules:
- Values must come from what is visibly readable in the image.
- If a field is unreadable or missing, use an empty string for text fields and "Unknown" for attendance; never invent values.
- age is the member's age written on the sheet (number, or empty when not present).
- attendance is keyed by COLUMN NUMBER, reading the marks from left to right. Column 1 is the first mark cell, column 2 the second, and so on.
- mark MUST be exactly one of: "tick", "x", "blank", "multiple", "unclear". When a cell holds more than one mark, use "multiple".
- status MUST be exactly one of: "Present", "Absent", "Unknown".
- Leave attendance as {} when the sheet has no attendance columns.
- Do not hallucinate people or rows that are not present.
- confidence is 0.0 to 1.0 per row reflecting how reliably the row was read.
- Add a short human-readable string to warnings for each field that was uncertain or unreadable.
- detected_headers should list the column headers you can read; empty array if none.
- attendance_dates should contain the date-like column headers you can read; empty array if none.
- attendance_column_count is the number of attendance mark columns on the sheet; 0 when there are none.
- Output the JSON object and nothing else, no markdown fences.`

const asString = (value) => (typeof value === 'string' ? value.trim() : '')

const asFiniteNumber = (value, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(1, parsed))
}

const asStringArray = (value) => {
  if (!Array.isArray(value)) return []
  return value.map(asString).filter(Boolean)
}

const ALLOWED_ATTENDANCE_STATUS = ['Present', 'Absent', 'Unknown']
const ALLOWED_ATTENDANCE_MARKS = ['tick', 'x', 'blank', 'multiple', 'unclear']

// Attendance accepts BOTH the legacy date-keyed shape { 'YYYY-MM-DD': 'Status' }
// and the column-indexed shape { '1': { mark, status } }. The raw mark is
// preserved so the reviewer can verify and interpret it against the sheet.
const sanitizeAttendance = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const mark = ALLOWED_ATTENDANCE_MARKS.includes(asString(entry.mark)) ? asString(entry.mark) : 'unclear'
      const status = ALLOWED_ATTENDANCE_STATUS.includes(asString(entry.status)) ? asString(entry.status) : 'Unknown'
      result[key] = { mark, status }
      continue
    }
    const status = asString(entry)
    result[key] = ALLOWED_ATTENDANCE_STATUS.includes(status) ? status : 'Unknown'
  }
  return result
}

export const normalizeExtraction = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExtractionError('MALFORMED_RESPONSE', 'Gemini returned an unexpected response shape.')
  }
  const sheet = raw.sheet && typeof raw.sheet === 'object' ? raw.sheet : {}
  const rawRows = Array.isArray(raw.rows) ? raw.rows : []
  const rows = rawRows.map((row) => {
    if (!row || typeof row !== 'object') {
      return {
        full_name: '',
        phone_number: '',
        gender: '',
        age: '',
        current_level: '',
        attendance: {},
        confidence: 0,
        warnings: ['Row was unreadable.']
      }
    }
    return {
      full_name: asString(row.full_name),
      phone_number: asString(row.phone_number),
      gender: asString(row.gender),
      age: asString(row.age),
      current_level: asString(row.current_level),
      attendance: sanitizeAttendance(row.attendance),
      confidence: asFiniteNumber(row.confidence),
      warnings: asStringArray(row.warnings)
    }
  })
  return {
    sheet: {
      detected_headers: asStringArray(sheet.detected_headers),
      attendance_dates: asStringArray(sheet.attendance_dates),
      ...(Number.isInteger(sheet.attendance_column_count) && sheet.attendance_column_count >= 0
        ? { attendance_column_count: sheet.attendance_column_count }
        : {})
    },
    rows,
    warnings: asStringArray(raw.warnings)
  }
}

// Copies the numeric token counts and modality detail arrays Gemini returns in
// usageMetadata. Unknown/extra fields are dropped so only well-formed counters
// (and their safe detail arrays) ever reach the client or the saved scan.
const USAGE_METADATA_FIELDS = [
  'promptTokenCount',
  'cachedContentTokenCount',
  'candidatesTokenCount',
  'thoughtsTokenCount',
  'toolUsePromptTokenCount'
]
const USAGE_METADATA_DETAIL_FIELDS = [
  'promptTokensDetails',
  'candidatesTokensDetails',
  'cacheTokensDetails'
]

export const normalizeUsageMetadata = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {}
  for (const key of USAGE_METADATA_FIELDS) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = value[key]
  }
  for (const key of USAGE_METADATA_DETAIL_FIELDS) {
    if (Array.isArray(value[key])) result[key] = value[key].map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const detail = {}
      if (typeof entry.modality === 'string') detail.modality = entry.modality
      if (typeof entry.tokenCount === 'number') detail.tokenCount = entry.tokenCount
      return Object.keys(detail).length ? detail : null
    }).filter(Boolean)
  }
  return Object.keys(result).length ? result : null
}

const extractJsonText = (response) => {
  const text = response?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
  if (text) return text
  return response?.text || ''
}

const parseJsonLoose = (text) => {
  const trimmed = String(text || '').trim()
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

const toExtractionError = (error) => {
  if (error instanceof ExtractionError) return error
  const status = error?.status || error?.code
  const message = String(error?.message || 'Gemini request failed.')
  const isInvalidKey = /API_KEY_INVALID|API key not valid/i.test(message)
  const isRateLimited = status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)
  const isModelUnavailable = status === 404 || /models?\/[a-z0-9.-]+ is no longer|NOT_FOUND/i.test(message)
  const isTimeout = status === 504 || status === 408 || /DEADLINE_EXCEEDED|timed out|timeout|ETIMEDOUT/i.test(message)
  if (isInvalidKey) {
    return new ExtractionError('INVALID_API_KEY', 'The Gemini API key is rejected by Google.', { httpStatus: 500 })
  }
  if (isRateLimited) {
    return new ExtractionError('RATE_LIMITED', 'Gemini rate limit or quota reached.', { retryable: true, httpStatus: 429 })
  }
  if (isModelUnavailable) {
    return new ExtractionError('MODEL_UNAVAILABLE', 'The requested Gemini model is unavailable.', { httpStatus: 503 })
  }
  if (isTimeout) {
    return new ExtractionError('PROVIDER_TIMEOUT', 'Gemini took too long to respond. Try again.', { retryable: true, httpStatus: 504 })
  }
  return new ExtractionError('GEMINI_API_ERROR', 'Gemini could not complete the request.', { retryable: true, httpStatus: 502 })
}

export const extractSheetWithGemini = async ({ imageBytes, mimeType, storedCredentialResolver = null }) => {
  if (!imageBytes || !(imageBytes instanceof Uint8Array) || imageBytes.length === 0) {
    throw new ExtractionError('MISSING_IMAGE', 'An image payload is required.', { httpStatus: 400 })
  }
  if (imageBytes.length > MAX_IMAGE_BYTES) {
    throw new ExtractionError('IMAGE_TOO_LARGE', 'The image is too large to process.', { httpStatus: 413 })
  }
  const apiKey = await getGeminiApiKey({ storedCredentialResolver })
  if (!apiKey) {
    throw new ExtractionError('SERVER_NOT_CONFIGURED', 'The server is missing its Gemini API key.', { httpStatus: 500 })
  }

  const genai = new GoogleGenAI({ apiKey })
  try {
    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: EXTRACTION_PROMPT },
            { inlineData: { mimeType, data: Buffer.from(imageBytes).toString('base64') } }
          ]
        }
      ]
    })
    const text = extractJsonText(response)
    if (!text) {
      throw new ExtractionError('EMPTY_RESPONSE', 'Gemini returned no readable content.', { httpStatus: 502 })
    }
    const parsed = parseJsonLoose(text)
    if (!parsed) {
      throw new ExtractionError('MALFORMED_RESPONSE', 'Gemini returned malformed JSON.', { httpStatus: 502 })
    }
    return {
      ...normalizeExtraction(parsed),
      usageMetadata: normalizeUsageMetadata(response?.usageMetadata)
    }
  } catch (error) {
    throw toExtractionError(error)
  }
}