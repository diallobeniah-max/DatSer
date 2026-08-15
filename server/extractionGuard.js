import { createClient } from '@supabase/supabase-js'
import { ExtractionError } from './extractionErrors.js'

// Mirrors the RPC constants in
// supabase/migrations/20260812_paper_scan_extraction_server_authoritative.sql.
export const QUOTA_PER_WINDOW = 40
export const QUOTA_WINDOW_MS = 60 * 60 * 1000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const getSupabaseServerConfig = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  return { url, anonKey }
}

const getServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Server-side resolver for a stored AI-provider credential. Returns the
// DECRYPTED provider key ONLY to the server runtime (never to a browser). Uses a
// service-role client so it can call the SECURITY DEFINER ai_provider_resolve_key
// RPC, which is revoked from browser roles. Falls back to '' when the stored
// credential is absent or the service key is not configured (the caller then
// falls through to the GEMINI_API_KEY environment variable).
export const resolveStoredGeminiKey = async ({ ownerId, provider = 'gemini' }) => {
  const { url } = getSupabaseServerConfig()
  const serviceRoleKey = getServiceRoleKey()
  if (!url || !serviceRoleKey || !ownerId) return ''
  try {
    const serviceClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
    const encryptionKey = process.env.AI_PROVIDER_ENCRYPTION_KEY || ''
    const { data, error } = await serviceClient.rpc('ai_provider_resolve_key', {
      p_owner_id: ownerId,
      p_provider: provider,
      p_encryption_key: encryptionKey
    })
    if (error || typeof data !== 'string' || !data) return ''
    return data
  } catch {
    return ''
  }
}

const createUserScopedClient = ({ url, anonKey, accessToken }) => {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  })
}

export const readBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim())
  return match ? match[1].trim() : ''
}

// Reads the workspace the client is acting for. Sent as a header so the
// handler can authenticate BEFORE buffering the image body.
export const readWorkspaceId = (req) => {
  const header = req.headers?.['x-datser-workspace-id'] || req.headers?.['X-DatSer-Workspace-Id'] || ''
  return String(header).trim()
}

// Verifies the Supabase session token server-side, then confirms the caller is
// authorized for the requested workspace. Mirrors the client's existing
// checkCollaboratorStatus: an owner may use their own id, and an accepted or
// active collaborator may use the owner's workspace they are linked to.
//
// Supabase anonymous sign-in (anon role) STILL passes getUser() with a valid
// auth.uid(), so it is explicitly rejected here before any workspace check or
// quota claim. Anonymous identities must never consume Gemini quota.
export const authenticateExtractionRequest = async ({ accessToken, workspaceId }) => {
  const { url, anonKey } = getSupabaseServerConfig()
  if (!url || !anonKey) {
    throw new ExtractionError('SERVER_NOT_CONFIGURED', 'The server is missing its Supabase configuration.', { httpStatus: 503 })
  }
  if (!accessToken) {
    throw new ExtractionError('AUTH_REQUIRED', 'Sign in before using Paper Scan Review.', { httpStatus: 401 })
  }

  const supabase = createUserScopedClient({ url, anonKey, accessToken })
  let user
  try {
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (error || !data?.user?.id) {
      throw new ExtractionError('SESSION_INVALID', 'Your sign-in session is no longer valid. Sign in again.', { httpStatus: 401 })
    }
    user = data.user
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    throw new ExtractionError('AUTH_UNAVAILABLE', 'Session verification is temporarily unavailable.', { httpStatus: 503 })
  }

  assertNotAnonymous(user)
  const ownerId = await resolveAuthorizedWorkspace({ supabase, user, workspaceId })
  return { supabase, user, ownerId }
}

const assertNotAnonymous = (user) => {
  const flags = [user?.is_anonymous, user?.app_metadata?.is_anonymous, user?.user_metadata?.is_anonymous]
  if (flags.some((flag) => flag === true)) {
    throw new ExtractionError('ANONYMOUS_NOT_ALLOWED', 'Sign in with a full account to use Paper Scan Review.', { httpStatus: 403 })
  }
}

const resolveAuthorizedWorkspace = async ({ supabase, user, workspaceId }) => {
  const requestedId = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  if (requestedId === user.id) return requestedId
  if (!requestedId) return user.id
  if (!UUID_RE.test(requestedId)) {
    throw new ExtractionError('WORKSPACE_NOT_AUTHORIZED', 'You are not authorized for this workspace.', { httpStatus: 403 })
  }

  const readOwnCollaboratorRows = async (filter) => {
    let chain = supabase
      .from('collaborators')
      .select('owner_id')
      .in('status', ['accepted', 'active'])
      .limit(25)
    chain = filter(chain)
    const { data, error } = await chain
    if (error) {
      throw new ExtractionError('WORKSPACE_CHECK_UNAVAILABLE', 'Workspace verification is temporarily unavailable.', { httpStatus: 503 })
    }
    return Array.isArray(data) ? data : []
  }

  const byUserId = await readOwnCollaboratorRows((chain) => chain.eq('collaborator_user_id', user.id))
  if (byUserId.some((row) => row.owner_id === requestedId)) return requestedId

  if (user.email) {
    const byEmail = await readOwnCollaboratorRows((chain) => chain.ilike('email', user.email))
    if (byEmail.some((row) => row.owner_id === requestedId)) return requestedId
  }

  throw new ExtractionError('WORKSPACE_NOT_AUTHORIZED', 'You are not authorized for this workspace.', { httpStatus: 403 })
}

// Removed assertImageQuota/recordExtraction. The pre-flight read + post-hoc
// write are not atomic, so a crash between them could double-spend Gemini
// quota. Everything now happens in one RPC call (see migration
// 20260812_paper_scan_extraction_server_authoritative.sql): the Ledger is
// checked, the request id is de-duplicated, and the row is inserted under an
// advisory lock, all in the same transaction.
export const claimImageSlot = async ({ supabase, user, ownerId, sha256, requestId }) => {
  if (!supabase || !user?.id || !ownerId || !sha256 || !requestId) {
    throw new ExtractionError('MISSING_IMAGE', 'An image payload is required.', { httpStatus: 400 })
  }
  const { data, error } = await supabase.rpc('claim_paper_scan_extraction', {
    p_owner_id: ownerId,
    p_request_id: requestId,
    p_image_sha256: sha256
  })
  if (error) {
    throw new ExtractionError('QUOTA_UNAVAILABLE', 'Extraction safeguards are temporarily unavailable.', { retryable: true, httpStatus: 503 })
  }
  const row = Array.isArray(data) ? (data[0] || {}) : (data || {})
  if (row.status !== 'claimed') {
    if (row.status === 'duplicate') {
      throw new ExtractionError('DUPLICATE_REQUEST', 'This extraction attempt was already submitted. Retry the sheet once more if you want a fresh extraction.', { httpStatus: 409 })
    }
    if (row.status === 'quota_exceeded') {
      throw new ExtractionError('QUOTA_EXCEEDED', 'You have reached the extraction limit for this hour. Try again later.', { httpStatus: 429 })
    }
    throw new ExtractionError('QUOTA_UNAVAILABLE', 'Extraction safeguards are temporarily unavailable.', { retryable: true, httpStatus: 503 })
  }
  return { extractionId: row.extraction_id }
}