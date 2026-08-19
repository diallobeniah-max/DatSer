// AI Provider settings — secure server operations for DatSer Paper Scan providers.
//
// The browser NEVER receives a full provider key. This endpoint authorizes the
// caller as a permanent workspace ADMIN/owner (server-side, via SECURITY DEFINER
// RPCs), then:
//   - GET  /api/ai-providers?ownerId=...&provider=gemini       -> status (configured,
//         maskedSuffix, model, lastVerified, status) only
//   - POST /api/ai-providers (set/replace)                      -> stores ENCRYPTED
//         secret + model server-side; returns success/status only
//   - POST /api/ai-providers/test                               -> minimal provider
//         request; returns Connected / sanitized error
//   - DELETE /api/ai-providers?ownerId=...&provider=gemini      -> removes credential
//   - GET/POST /api/ai-providers/routing                        -> primary/fallback
//
// The encryption key (AI_PROVIDER_ENCRYPTION_KEY) lives ONLY in the server env.
import { createClient } from '@supabase/supabase-js'
import { authenticateExtractionRequest, readBearerToken, readWorkspaceId, resolveRouting, resolveStoredProviderKey } from '../server/extractionGuard.js'
import { ExtractionError } from '../server/extractionErrors.js'
import { resolveServerGeminiCredential } from '../server/geminiKey.js'
import { testGeminiConnection } from '../server/geminiExtract.js'
import { extractSheetWithQwen } from '../server/qwenExtract.js'

export const config = { maxDuration: 30 }

const send = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

const readJsonBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({ parseError: true }) }
    })
    req.on('error', () => resolve({}))
  })
}

// Classifies a Supabase RPC/PostgREST error. Returns a stable code + a safe,
// sanitized message. DB/infrastructure failures (missing function, schema issue,
// RLS/authorization) are surfaced truthfully and NOT conflated with a bad key.
export const classifyRpcError = (error, fallbackCode = 'STORAGE_UNAVAILABLE') => {
  const raw = String(error?.message || error?.error || error?.details || '')
  const lower = raw.toLowerCase()
  // Storage/function/pgcrypto/config failures must be reported as storage
  // unavailability, NOT conflated with a bad key or with RLS.
  if (/function.*does not exist|pgp_sym|pgcrypto|could not find a function|42883/i.test(lower)) {
    return { code: 'STORAGE_UNAVAILABLE', httpStatus: 503, error: 'Provider credential storage is temporarily unavailable.' }
  }
  if (/encryption key|encryption/i.test(lower)) {
    return { code: 'STORAGE_UNAVAILABLE', httpStatus: 503, error: 'Provider credential storage is not fully configured.' }
  }
  // Authorization/RLS errors (distinct from the storage errors above).
  if (/authorized|admin|owner|workspace|42501|permission|not allowed|not authorized/i.test(lower)) {
    return { code: 'FORBIDDEN', httpStatus: 403, error: 'You are not authorized to manage AI provider credentials.' }
  }
  // Anything else is a generic storage/infrastructure failure — never leak the
  // raw database internals to the normal UI.
  return { code: fallbackCode, httpStatus: 503, error: 'Provider credential storage is temporarily unavailable.' }
}

// Minimal provider call purely to verify a credential. Uses a tiny prompt so it
// is inexpensive; any non-credential failure surfaces a sanitized error. This
// maps ONLY provider errors (bad key / quota / model / timeout). Infrastructure
// failures (storage/unresolvable credential) are handled by the caller and are
// never conflated with a bad key.
const testProviderKey = async ({ provider, apiKey, model }) => {
  try {
    if (provider === 'qwen') {
      await extractSheetWithQwen({
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
        apiKey,
        model: model || undefined
      })
      return { ok: true, status: 'connected' }
    }
    await testGeminiConnection({ apiKey, model: model || undefined })
    return { ok: true, status: 'connected' }
  } catch (error) {
    const code = error?.code || 'PROVIDER_ERROR'
    if (code === 'INVALID_API_KEY') {
      return { ok: false, status: 'invalid_key', error: 'The provider API key is rejected.' }
    }
    if (code === 'RATE_LIMITED') {
      return { ok: false, status: 'quota_unavailable', error: 'Provider quota is currently unavailable.' }
    }
    if (code === 'PROVIDER_TIMEOUT') {
      return { ok: false, status: 'provider_timeout', error: 'The provider took too long to respond. Try again.' }
    }
    if (code === 'MODEL_UNAVAILABLE') {
      return { ok: false, status: 'model_unavailable', error: 'The selected model is unavailable.' }
    }
    if (code === 'SERVER_NOT_CONFIGURED') {
      return { ok: false, status: 'server_not_configured', error: 'The provider is not configured.' }
    }
    return { ok: false, status: 'provider_unavailable', error: 'The provider could not be reached. Try again shortly.' }
  }
}

const PROVIDERS = ['gemini', 'qwen']

export default async function handler(req, res) {
  let identity
  try {
    identity = await authenticateExtractionRequest({
      accessToken: readBearerToken(req),
      workspaceId: readWorkspaceId(req)
    })
  } catch (error) {
    send(res, error?.httpStatus || 401, { ok: false, error: error?.message || 'Unauthorized' })
    return
  }

  const url = new URL(req.url, 'http://localhost')
  const ownerId = url.searchParams.get('ownerId') || identity.ownerId
  const provider = url.searchParams.get('provider') || 'gemini'
  // Routing can be reached via the direct subpath (/api/ai-providers/routing) or,
  // when Vercel's file-based routing falls the subpath through to the SPA rewrite,
  // via the /api/ai-providers?routing=1 rewrite defined in vercel.json.
  const isRouting = url.pathname.endsWith('/routing') || url.searchParams.get('routing') === '1'
  const encryptionKey = process.env.AI_PROVIDER_ENCRYPTION_KEY || ''
  if (!encryptionKey) {
    send(res, 503, { ok: false, error: 'Server encryption is not configured.' })
    return
  }

  const client = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${readBearerToken(req)}` } }
    }
  )

  try {
    // Routing read/write
    if (isRouting) {
      if (req.method === 'GET') {
        const { data, error } = await client.rpc('ai_provider_get_routing', { p_owner_id: ownerId })
        if (error) throw new ExtractionError('ROUTING_UNAVAILABLE', error.message, { httpStatus: 503 })
        send(res, 200, { ok: true, ...(Array.isArray(data) ? (data[0] || {}) : data || {}) })
        return
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        if (body?.parseError) { send(res, 400, { ok: false, error: 'Invalid JSON body' }); return }
        const primary = String(body?.primary || 'gemini')
        const fallback = body?.fallback ? String(body.fallback) : null
        if (!PROVIDERS.includes(primary)) { send(res, 400, { ok: false, error: 'Unsupported primary provider.' }); return }
        if (fallback && !PROVIDERS.includes(fallback)) { send(res, 400, { ok: false, error: 'Unsupported fallback provider.' }); return }
        const { data, error } = await client.rpc('ai_provider_set_routing', {
          p_owner_id: ownerId, p_primary: primary, p_fallback: fallback
        })
        if (error) {
          const mapped = classifyRpcError(error)
          send(res, mapped.httpStatus, { ok: false, code: mapped.code, error: mapped.error })
          return
        }
        send(res, 200, { ok: true, ...(Array.isArray(data) ? (data[0] || {}) : data || {}) })
        return
      }
      send(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    if (req.method === 'GET') {
      const { data, error } = await client.rpc('ai_provider_get_status', { p_owner_id: ownerId, p_provider: provider })
      if (error) throw new ExtractionError('PROVIDER_STATUS_UNAVAILABLE', error.message, { httpStatus: 503 })
      send(res, 200, { ok: true, ...(Array.isArray(data) ? (data[0] || {}) : data || {}) })
      return
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      if (body?.parseError) { send(res, 400, { ok: false, error: 'Invalid JSON body' }); return }

      if (body?.action === 'test') {
        const secret = typeof body?.secret === 'string' ? body.secret.trim() : ''
        let model = typeof body?.model === 'string' ? body.model.trim() : ''
        // A deployment-managed Gemini credential is the runtime source of
        // truth. It lets Paper Scan recover from a stale or unreadable legacy
        // encrypted record without sending any key to the browser. An explicit
        // key submitted for this one health check still wins intentionally.
        // Use the exact same server-only Gemini resolver as Paper Scan. This
        // avoids showing a healthy status for a stale PROCESS-scoped key that
        // extraction would (correctly) avoid on Windows.
        const environmentGeminiCredential = provider === 'gemini'
          ? await resolveServerGeminiCredential()
          : { key: '' }
        const environmentGeminiKey = environmentGeminiCredential.key
        let apiKey = secret || environmentGeminiKey
        let credentialSource = secret ? 'submitted' : (environmentGeminiKey ? 'environment' : 'stored')
        if (!apiKey) {
          const resolved = await resolveStoredProviderKey({ ownerId, provider })
          if (resolved.status === 'unavailable' || resolved.status === 'unreadable') {
            // The canonical resolver above is the only environment path.
            // Never read a raw process key here: that would bypass Windows
            // User-scope preference and reintroduce stale-key selection.
            apiKey = environmentGeminiKey
            credentialSource = apiKey ? 'environment' : 'stored'
            if (!apiKey) {
              send(res, 200, {
                ok: true,
                status: 'credential_unavailable',
                code: resolved.code || 'STORED_CREDENTIAL_UNREADABLE',
                error: 'The stored provider credential could not be read by the server.'
              })
              return
            }
          } else {
            apiKey = resolved.key || ''
            if (!model) model = resolved.model || ''
          }
        }
        if (!apiKey) {
          send(res, 200, { ok: true, status: 'not_configured' })
          return
        }
        const result = await testProviderKey({ provider, apiKey, model })
        if (result.ok) {
          // Supabase RPC resolves to { data, error }; it is not a promise-like
          // object with a catch method. Verification metadata is best-effort,
          // but a failure must be handled explicitly and must not turn a valid
          // provider health check into a generic server error.
          try {
            const { error: verificationError } = await client.rpc('ai_provider_mark_verified', {
              p_owner_id: ownerId,
              p_provider: provider
            })
            if (verificationError) {
              // The health result is authoritative. Do not expose database
              // details or fail a successful provider check over audit metadata.
            }
          } catch {
            // The health result is authoritative. Network failures while
            // recording verification are intentionally non-fatal.
          }
        }
        send(res, 200, { ok: true, ...result, credentialSource })
        return
      }

      // set / replace key (+ optional model)
      const secret = typeof body?.secret === 'string' ? body.secret.trim() : ''
      const model = typeof body?.model === 'string' ? body.model.trim() : ''
      if (!secret || secret.length < 10) {
        send(res, 400, { ok: false, error: 'A valid provider API key is required.' })
        return
      }
      const { data, error } = await client.rpc('ai_provider_set_secret', {
        p_owner_id: ownerId,
        p_provider: provider,
        p_secret: secret,
        p_encryption_key: encryptionKey,
        p_model: model
      })
      if (error) {
        const mapped = classifyRpcError(error, 'STORAGE_UNAVAILABLE')
        send(res, mapped.httpStatus, { ok: false, code: mapped.code, error: mapped.error })
        return
      }
      send(res, 200, { ok: true, ...(Array.isArray(data) ? (data[0] || {}) : data || {}) })
      return
    }

    if (req.method === 'DELETE') {
      const { data, error } = await client.rpc('ai_provider_remove', { p_owner_id: ownerId, p_provider: provider })
      if (error) {
        const mapped = classifyRpcError(error, 'STORAGE_UNAVAILABLE')
        send(res, mapped.httpStatus, { ok: false, code: mapped.code, error: mapped.error })
        return
      }
      send(res, 200, { ok: true, ...(Array.isArray(data) ? (data[0] || {}) : data || {}) })
      return
    }

    send(res, 405, { ok: false, error: 'Method not allowed' })
  } catch (error) {
    send(res, error?.httpStatus || 500, { ok: false, error: error?.message || 'Provider settings failed.' })
  }
}
