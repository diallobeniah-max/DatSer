import { beforeEach, describe, expect, it, vi } from 'vitest'

const geminiMock = vi.hoisted(() => ({
  extractSheetWithGemini: vi.fn()
}))
const qwenMock = vi.hoisted(() => ({
  extractSheetWithQwen: vi.fn()
}))

vi.mock('./geminiExtract.js', () => ({
  extractSheetWithGemini: geminiMock.extractSheetWithGemini
}))
vi.mock('./qwenExtract.js', () => ({
  extractSheetWithQwen: qwenMock.extractSheetWithQwen
}))

import { extractPaperScan, isRetryableProviderError, resolveProviderKeys } from './providerRouting.js'
import { ExtractionError } from './extractionErrors.js'

const sampleResult = { sheet: { detected_headers: [] }, rows: [], warnings: [] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('provider key resolution', () => {
  it('resolves stored credentials with key + model per provider', async () => {
    const keys = await resolveProviderKeys({
      storedResolvers: {
        gemini: async () => ({ key: 'AIzaSyStoredKeyValue', model: 'gemini-3.1-flash-lite' }),
        qwen: async () => ({ key: 'sk-qwen-stored-key', model: 'qwen-vl-max' })
      },
      envKeys: { gemini: 'env-fallback', qwen: '' }
    })
    expect(keys.gemini.key).toBe('AIzaSyStoredKeyValue')
    expect(keys.gemini.model).toBe('gemini-3.1-flash-lite')
    expect(keys.qwen.key).toBe('sk-qwen-stored-key')
    expect(keys.qwen.model).toBe('qwen-vl-max')
  })

  it('falls back to env keys when no stored credential exists', async () => {
    const keys = await resolveProviderKeys({
      storedResolvers: {
        gemini: async () => '',
        qwen: async () => ({ key: '', model: '' })
      },
      envKeys: { gemini: 'GEMINI_ENV_KEY', qwen: 'QWEN_ENV_KEY' }
    })
    expect(keys.gemini.key).toBe('GEMINI_ENV_KEY')
    expect(keys.qwen.key).toBe('QWEN_ENV_KEY')
  })

  it('tolerates a throwing stored resolver', async () => {
    const keys = await resolveProviderKeys({
      storedResolvers: { gemini: async () => { throw new Error('db down') } },
      envKeys: { gemini: 'ENV_KEY' }
    })
    expect(keys.gemini.key).toBe('ENV_KEY')
  })
})

describe('retryable provider error classification', () => {
  it('treats rate limit / timeout / quota as retryable', () => {
    expect(isRetryableProviderError(new ExtractionError('RATE_LIMITED', 'limit', { retryable: true }))).toBe(true)
    expect(isRetryableProviderError(new ExtractionError('PROVIDER_TIMEOUT', 'timeout', { retryable: true }))).toBe(true)
    expect(isRetryableProviderError({ code: 'GEMINI_API_ERROR', retryable: true })).toBe(true)
  })

  it('does not treat permanent errors as retryable', () => {
    expect(isRetryableProviderError(new ExtractionError('INVALID_API_KEY', 'bad key', { httpStatus: 500 }))).toBe(false)
    expect(isRetryableProviderError(new ExtractionError('MODEL_UNAVAILABLE', 'model', { httpStatus: 503 }))).toBe(false)
  })
})

describe('extractPaperScan routing', () => {
  const imageBytes = new Uint8Array([1, 2, 3])
  const mimeType = 'image/jpeg'

  it('returns primary result with metadata when it succeeds', async () => {
    geminiMock.extractSheetWithGemini.mockResolvedValue(sampleResult)
    const result = await extractPaperScan({
      imageBytes,
      mimeType,
      providerKeys: { gemini: { key: 'gemini-key', model: 'gemini-3.1-flash-lite' } },
      routing: { primaryProvider: 'gemini', fallbackProvider: null }
    })
    expect(result.sheet).toBeTruthy()
    expect(result.metadata.provider).toBe('gemini')
    expect(result.metadata.fallbackUsed).toBe(false)
    expect(geminiMock.extractSheetWithGemini).toHaveBeenCalledTimes(1)
    expect(qwenMock.extractSheetWithQwen).not.toHaveBeenCalled()
  })

  it('falls back to the configured provider on a retryable failure and tags it', async () => {
    geminiMock.extractSheetWithGemini.mockRejectedValue(
      new ExtractionError('RATE_LIMITED', 'limit', { retryable: true, httpStatus: 429 })
    )
    qwenMock.extractSheetWithQwen.mockResolvedValue(sampleResult)
    const result = await extractPaperScan({
      imageBytes,
      mimeType,
      providerKeys: {
        gemini: { key: 'gemini-key', model: '' },
        qwen: { key: 'qwen-key', model: 'qwen-vl-max' }
      },
      routing: { primaryProvider: 'gemini', fallbackProvider: 'qwen' }
    })
    expect(result.sheet).toBeTruthy()
    expect(result.metadata.provider).toBe('qwen')
    expect(result.metadata.fallbackUsed).toBe(true)
    expect(qwenMock.extractSheetWithQwen).toHaveBeenCalledTimes(1)
  })

  it('does not fall back on a permanent error (invalid key)', async () => {
    geminiMock.extractSheetWithGemini.mockRejectedValue(
      new ExtractionError('INVALID_API_KEY', 'bad key', { httpStatus: 500 })
    )
    qwenMock.extractSheetWithQwen.mockResolvedValue(sampleResult)
    await expect(extractPaperScan({
      imageBytes,
      mimeType,
      providerKeys: {
        gemini: { key: 'gemini-bad-key', model: '' },
        qwen: { key: 'qwen-key', model: '' }
      },
      routing: { primaryProvider: 'gemini', fallbackProvider: 'qwen' }
    })).rejects.toThrow()
    expect(qwenMock.extractSheetWithQwen).not.toHaveBeenCalled()
  })

  it('throws a clear error when the primary provider is not configured', async () => {
    await expect(extractPaperScan({
      imageBytes,
      mimeType,
      providerKeys: {},
      routing: { primaryProvider: 'gemini', fallbackProvider: null }
    })).rejects.toThrow(/not configured/i)
  })

  it('only calls the primary provider when no fallback is configured', async () => {
    geminiMock.extractSheetWithGemini.mockResolvedValue(sampleResult)
    const result = await extractPaperScan({
      imageBytes,
      mimeType,
      providerKeys: {
        gemini: { key: 'gemini-key', model: '' },
        qwen: { key: 'qwen-key', model: '' }
      },
      routing: { primaryProvider: 'gemini', fallbackProvider: null }
    })
    expect(result.metadata.provider).toBe('gemini')
    expect(result.metadata.fallbackUsed).toBe(false)
    expect(geminiMock.extractSheetWithGemini).toHaveBeenCalledTimes(1)
    expect(qwenMock.extractSheetWithQwen).not.toHaveBeenCalled()
  })

  it('surfaces the fallback error when both primary and fallback fail', async () => {
    geminiMock.extractSheetWithGemini.mockRejectedValue(
      new ExtractionError('RATE_LIMITED', 'primary rate limited', { retryable: true, httpStatus: 429 })
    )
    qwenMock.extractSheetWithQwen.mockRejectedValue(
      new ExtractionError('PROVIDER_TIMEOUT', 'fallback timeout', { retryable: true, httpStatus: 504 })
    )
    await expect(extractPaperScan({
      imageBytes,
      mimeType,
      providerKeys: {
        gemini: { key: 'gemini-key', model: '' },
        qwen: { key: 'qwen-key', model: '' }
      },
      routing: { primaryProvider: 'gemini', fallbackProvider: 'qwen' }
    })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
  })
})
