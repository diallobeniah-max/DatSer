import { ExtractionError } from './extractionErrors.js'
import { extractSheetWithGemini } from './geminiExtract.js'
import { extractSheetWithQwen } from './qwenExtract.js'

// Paper Scan provider routing — OpenCode-style, deliberately simple.
//
// extractPaperScan():
//   1. resolve the configured primary provider
//   2. attempt extraction
//   3. if it SUCCEEDS -> return the normalized result
//   4. if it fails with a RETRYABLE / temporary error and a fallback is
//      configured -> try the fallback
//   5. if the fallback succeeds -> return its normalized result
//   6. if all configured providers fail -> throw a clear error
//
// Permanent errors (invalid key, bad request, unsupported model, malformed
// input) do NOT fall back — they stop and explain the problem, so a
// configuration bug never burns credits across every provider.
//
// The result is always normalized to DatSer's single extraction shape, tagged
// with which provider/model was used and whether a fallback was exercised.

const PROVIDERS = ['gemini', 'qwen']

// A provider failure is temporary/retryable when it might succeed on another
// provider or after a short wait. Permanent credential/request errors never
// trigger a fallback.
export const isRetryableProviderError = (error) => {
  if (!error) return false
  if (error.retryable === true) return true
  const code = String(error?.code || '')
  return ['RATE_LIMITED', 'PROVIDER_TIMEOUT', 'QUOTA_UNAVAILABLE', 'GEMINI_API_ERROR'].includes(code)
}

export const resolveProviderKeys = async ({
  storedResolvers = {}, // { provider: async () => { key, model } }
  envKeys = {} // { provider: key }
}) => {
  const result = {}
  for (const provider of PROVIDERS) {
    let key = ''
    let model = ''
    const resolver = storedResolvers?.[provider]
    if (typeof resolver === 'function') {
      try {
        const resolved = await resolver()
        if (resolved && typeof resolved === 'object') {
          key = resolved.key || ''
          model = resolved.model || ''
        } else if (typeof resolved === 'string') {
          key = resolved
        }
      } catch {
        // fall through to env
      }
    }
    if (!key && envKeys?.[provider]) key = envKeys[provider]
    if (key) result[provider] = { key, model }
  }
  return result
}

const runProvider = async ({ provider, config, imageBytes, mimeType }) => {
  if (provider === 'gemini') {
    return extractSheetWithGemini({
      imageBytes,
      mimeType,
      storedCredentialResolver: () => config.key
    })
  }
  if (provider === 'qwen') {
    return extractSheetWithQwen({
      imageBytes,
      mimeType,
      apiKey: config.key,
      model: config.model
    })
  }
  throw new ExtractionError('PROVIDER_UNAVAILABLE', `Unknown provider: ${provider}`, { httpStatus: 503 })
}

export const extractPaperScan = async ({
  imageBytes,
  mimeType,
  providerKeys = {}, // { provider: { key, model } } (already resolved)
  routing = { primaryProvider: 'gemini', fallbackProvider: null }
}) => {
  const primary = routing?.primaryProvider || 'gemini'
  const fallback = routing?.fallbackProvider || null

  const primaryConfig = providerKeys?.[primary]
  if (!primaryConfig?.key) {
    throw new ExtractionError('SERVER_NOT_CONFIGURED', 'The primary extraction provider is not configured.', { httpStatus: 500 })
  }

  const attempt = async (provider) => {
    const config = providerKeys?.[provider]
    if (!config?.key) {
      throw new ExtractionError('SERVER_NOT_CONFIGURED', `The ${provider} provider is not configured.`, { httpStatus: 500 })
    }
    return runProvider({ provider, config, imageBytes, mimeType })
  }

  try {
    const result = await attempt(primary)
    return {
      ...result,
      metadata: {
        provider: primary,
        model: providerKeys[primary].model || '',
        fallbackUsed: false
      }
    }
  } catch (primaryError) {
    if (fallback && isRetryableProviderError(primaryError)) {
      try {
        const result = await attempt(fallback)
        return {
          ...result,
          metadata: {
            provider: fallback,
            model: providerKeys[fallback].model || '',
            fallbackUsed: true
          }
        }
      } catch (fallbackError) {
        // Both failed; surface the more actionable error.
        throw fallbackError
      }
    }
    // Permanent error or no fallback: stop and explain.
    throw primaryError
  }
}
