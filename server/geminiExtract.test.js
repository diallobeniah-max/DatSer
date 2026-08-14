import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getGeminiApiKey: vi.fn(),
  generateContent: vi.fn()
}))

vi.mock('./geminiKey.js', () => ({
  getGeminiApiKey: mocks.getGeminiApiKey
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    models: { generateContent: mocks.generateContent }
  }))
}))

const { extractSheetWithGemini, GEMINI_MODEL, normalizeExtraction, normalizeUsageMetadata } = await import('./geminiExtract.js')
const { ExtractionError } = await import('./extractionErrors.js')

const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4])
const MIME = 'image/png'

const genaiResponse = (text) => ({
  candidates: [{ content: { parts: [{ text }] } }]
})

beforeEach(() => {
  mocks.getGeminiApiKey.mockReturnValue('AIzaSyValidTestKey123456')
  mocks.generateContent.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('geminiExtract successful extraction path', () => {
  it('uses the configured model and returns normalized rows', async () => {
    mocks.generateContent.mockResolvedValue(genaiResponse(JSON.stringify({
      sheet: { detected_headers: ['Name'], attendance_dates: ['2026-07-05'] },
      rows: [
        { full_name: 'Ama Serwaa', phone_number: '0241111111', gender: 'Female', current_level: 'SHS1', attendance: { '2026-07-05': 'Present' }, confidence: 0.9, warnings: [] }
      ],
      warnings: []
    })))
    const result = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
    expect(GEMINI_MODEL).toBe('gemini-3.1-flash-lite')
    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-lite' }))
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].full_name).toBe('Ama Serwaa')
    expect(result.rows[0].attendance['2026-07-05']).toBe('Present')
    expect(result.sheet.detected_headers).toEqual(['Name'])
  })

  it('strips markdown fences from the Gemini JSON response', async () => {
    mocks.generateContent.mockResolvedValue(genaiResponse('```json\n{"sheet":{},"rows":[]}\n```'))
    const result = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
    expect(result).toEqual({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [], usageMetadata: null })
  })

  it('captures Gemini usageMetadata token counts alongside the extraction', async () => {
    mocks.generateContent.mockResolvedValue({
      ...genaiResponse('{"sheet":{},"rows":[]}'),
      usageMetadata: {
        promptTokenCount: 128,
        candidatesTokenCount: 64,
        totalThoughts: 'ignore-me'
      }
    })
    const result = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
    expect(result.usageMetadata).toEqual({
      promptTokenCount: 128,
      candidatesTokenCount: 64
    })
  })

  it('normalizes unknown attendance values to Unknown and clamps confidence', async () => {
    mocks.generateContent.mockResolvedValue(genaiResponse(JSON.stringify({
      sheet: {},
      rows: [{ full_name: 'X', attendance: { '2026-07-05': 'Maybe' }, confidence: 3, warnings: ['fuzzy'] }]
    })))
    const result = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
    expect(result.rows[0].attendance['2026-07-05']).toBe('Unknown')
    expect(result.rows[0].confidence).toBe(1)
  })

  it('preserves raw column-indexed attendance marks when the model returns them', async () => {
    mocks.generateContent.mockResolvedValue(genaiResponse(JSON.stringify({
      sheet: {},
      rows: [{
        full_name: 'Ama Serwaa',
        attendance: {
          1: { mark: 'tick', status: 'Present' },
          2: { mark: 'x', status: 'Absent' },
          3: { mark: 'blank', status: 'Unknown' },
          4: { mark: 'garbage-mark', status: 'Present' }
        }
      }]
    })))
    const result = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
    expect(result.rows[0].attendance).toEqual({
      1: { mark: 'tick', status: 'Present' },
      2: { mark: 'x', status: 'Absent' },
      3: { mark: 'blank', status: 'Unknown' },
      4: { mark: 'unclear', status: 'Present' }
    })
  })

  it('supplies the image as base64 inlineData', async () => {
    mocks.generateContent.mockResolvedValue(genaiResponse('{"sheet":{},"rows":[]}'))
    await extractSheetWithGemini({ imageBytes: new Uint8Array([104, 105]), mimeType: 'image/jpeg' })
    const call = mocks.generateContent.mock.calls[0][0]
    const part = call.contents[0].parts.find((p) => p.inlineData)
    expect(part.inlineData.mimeType).toBe('image/jpeg')
    expect(part.inlineData.data).toBe(Buffer.from([104, 105]).toString('base64'))
  })
})

describe('geminiExtract error mapping', () => {
  it('throws SERVER_NOT_CONFIGURED when no API key resolves', async () => {
    mocks.getGeminiApiKey.mockReturnValue('')
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error).toBeInstanceOf(ExtractionError)
    expect(error.code).toBe('SERVER_NOT_CONFIGURED')
    expect(error.httpStatus).toBe(500)
  })

  it('maps an invalid API key to INVALID_API_KEY', async () => {
    mocks.generateContent.mockRejectedValue(new Error('API key not valid. Please pass a valid API key. status: 400'))
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('INVALID_API_KEY')
  })

  it('maps HTTP 429 / RESOURCE_EXHAUSTED to RATE_LIMITED as retryable', async () => {
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('RESOURCE_EXHAUSTED quota'), { status: 429 }))
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.retryable).toBe(true)
    expect(error.httpStatus).toBe(429)
  })

  it('maps a provider timeout to PROVIDER_TIMEOUT as retryable', async () => {
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('request timed out'), { status: 504 }))
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('PROVIDER_TIMEOUT')
    expect(error.retryable).toBe(true)
    expect(error.httpStatus).toBe(504)
  })

  it('maps a 404 model-not-found to MODEL_UNAVAILABLE', async () => {
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('models/gemini-x is no longer available'), { status: 404 }))
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('MODEL_UNAVAILABLE')
    expect(error.httpStatus).toBe(503)
  })

  it('maps malformed Gemini JSON to MALFORMED_RESPONSE', async () => {
    mocks.generateContent.mockResolvedValue(genaiResponse('not json at all'))
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('MALFORMED_RESPONSE')
  })

  it('maps an empty Gemini reply to EMPTY_RESPONSE', async () => {
    mocks.generateContent.mockResolvedValue({ candidates: [] })
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('EMPTY_RESPONSE')
  })

  it('maps unknown provider errors to GEMINI_API_ERROR as retryable', async () => {
    mocks.generateContent.mockRejectedValue(new Error('some unexpected provider failure'))
    const error = await extractSheetWithGemini({ imageBytes: IMAGE_BYTES, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('GEMINI_API_ERROR')
    expect(error.retryable).toBe(true)
  })

  it('rejects a missing image payload before calling Gemini', async () => {
    const error = await extractSheetWithGemini({ imageBytes: null, mimeType: MIME })
      .then(() => null, (e) => e)
    expect(error.code).toBe('MISSING_IMAGE')
    expect(mocks.generateContent).not.toHaveBeenCalled()
  })
})

describe('geminiExtract normalizeExtraction', () => {
  it('coerces a malformed top-level shape to a safe structure', () => {
    const normalized = normalizeExtraction({ rows: 'nope', sheet: null })
    expect(normalized).toEqual({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] })
  })

  it('turns an unreadable row into a safe placeholder with a warning', () => {
    const normalized = normalizeExtraction({ rows: [null] })
    expect(normalized.rows[0].full_name).toBe('')
    expect(normalized.rows[0].warnings).toEqual(['Row was unreadable.'])
  })
})

describe('geminiExtract normalizeUsageMetadata', () => {
  it('keeps only known numeric counters and detail arrays', () => {
    const usage = normalizeUsageMetadata({
      promptTokenCount: 10,
      candidatesTokenCount: 4,
      thoughtsTokenCount: 0,
      arbitrary: 'dropped',
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, {}]
    })
    expect(usage).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 4,
      thoughtsTokenCount: 0,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }]
    })
  })

  it('returns null for empty or malformed usage metadata', () => {
    expect(normalizeUsageMetadata(null)).toBeNull()
    expect(normalizeUsageMetadata({})).toBeNull()
    expect(normalizeUsageMetadata([1, 2])).toBeNull()
  })
})
