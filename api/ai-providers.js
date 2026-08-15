// AI Provider settings — secure server operations for DatSer Paper Scan providers.
//
// The browser NEVER receives a full provider key. This endpoint authorizes the
// caller as a permanent workspace ADMIN/owner (server-side, via SECURITY DEFINER
// RPCs), then:
//   - GET  /api/ai-providers?ownerId=...&provider=gemini  -> status (configured,
//         maskedSuffix, lastVerified, status) only
//   - POST /api/ai-providers (set/replace)                 -> stores ENCRYPTED
//         secret server-side; returns success/status only
//   - POST /api/ai-providers/test                          -> minimal provider
//         request; returns Connected / sanitized error
//   - DELETE /api/ai-providers?ownerId=...&provider=gemini -> removes credential
//
// The encryption key (AI_PROVIDER_ENCRYPTION_KEY) lives ONLY in the server env.
import { createClient } from '@supabase/supabase-js'
import { authenticateExtractionRequest, readBearerToken, readWorkspaceId } from '../server/extractionGuard.js'
import { ExtractionError } from '../server/extractionErrors.js'
import { extractSheetWithGemini } from '../server/geminiExtract.js'

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

// Minimal Gemini call purely to verify a credential. Uses a tiny prompt so it is
// inexpensive; any non-credential failure surfaces a sanitized error.
const testGeminiKey = async ({ apiKey, ownerId }) => {
  try {
    const payload = await extractSheetWithGemini({
      imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      storedCredentialResolver: () => apiKey
    })
    // A well-formed response means the credential worked. Mark lastVerified.
    return { ok: true, status: 'connected' }
  } catch (error) {
    const code = error?.code || 'GEMINI_API_ERROR'
    if (code === 'INVALID_API_KEY') {
      return { ok: false, status: 'invalid_key', error: 'The Gemini API key is rejected by Google.' }
    }
    if (code === 'RATE_LIMITED') {
      return { ok: false, status: 'quota_unavailable', error: 'Gemini quota is currently unavailable.' }
    }
    if (code === 'MODEL_UNAVAILABLE' || code === 'SERVER_NOT_CONFIGURED') {
      return { ok: false, status: 'provider_unavailable', error: 'The Gemini provider is unavailable.' }
    }
    return { ok: false, status: 'provider_unavailable', error: 'Could not reach Gemini. Check the key and try again.' }
  }
}

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
        // Test uses the currently stored secret (if any) or an explicit key sent
        // alongside "Save & Test". Never persist a test-only key.
        const secret = typeof body?.secret === 'string' ? body.secret.trim() : ''
        let apiKey = secret
        if (!apiKey) {
          const serviceClient = createClient(
            process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
          )
          const { data: resolved, error: resolveError } = await serviceClient.rpc('ai_provider_resolve_key', {
            p_owner_id: ownerId, p_provider: provider, p_encryption_key: encryptionKey
          })
          if (!resolveError && typeof resolved === 'string') apiKey = resolved
        }
        if (!apiKey) {
          send(res, 200, { ok: true, status: 'not_configured' })
          return
        }
        const result = await testGeminiKey({ apiKey, ownerId })
        if (result.ok) {
          await client.rpc('ai_provider_mark_verified', { p_owner_id: ownerId, p_provider: provider }).catch(() => {})
        }
        send(res, 200, { ok: true, ...result })
        return
      }

      // set / replace key
      const secret = typeof body?.secret === 'string' ? body.secret.trim() : ''
      if (!secret || secret.length < 10) {
        send(res, 400, { ok: false, error: 'A valid Gemini API key is required.' })
        return
      }
      const { data, error } = await client.rpc('ai_provider_set_secret', {
        p_owner_id: ownerId,
        p_provider: provider,
        p_secret: secret,
        p_encryption_key: encryptionKey
      })
      if (error) {
        const isAuthz = /authorized|admin|owner|workspace|42501/i.test(String(error.message || ''))
        send(res, isAuthz ? 403 : 503, { ok: false, error: error.message || 'Could not save the provider key.' })
        return
      }
      send(res, 200, { ok: true, ...(Array.isArray(data) ? (data[0] || {}) : data || {}) })
      return
    }

    if (req.method === 'DELETE') {
      const { data, error } = await client.rpc('ai_provider_remove', { p_owner_id: ownerId, p_provider: provider })
      if (error) {
        const isAuthz = /authorized|admin|owner|workspace|42501/i.test(String(error.message || ''))
        send(res, isAuthz ? 403 : 503, { ok: false, error: error.message || 'Could not remove the provider key.' })
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
