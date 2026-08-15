import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn()
}))

import { createClient } from '@supabase/supabase-js'
import {
  authenticateExtractionRequest,
  claimImageSlot,
  readBearerToken,
  readWorkspaceId
} from './extractionGuard.js'

const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@test.dev' }
const OWNER_ID = '00000000-0000-4000-8000-000000000002'
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000003'
const SHA = 'a'.repeat(64)
const REQUEST_ID = 'extract-1-abc'

const makeBuilder = (response) => {
  const builder = {
    data: response?.data ?? null,
    error: response?.error ?? null
  }
  builder.select = () => builder
  builder.in = () => builder
  builder.limit = () => builder
  builder.eq = () => builder
  builder.gte = () => builder
  builder.ilike = () => builder
  builder.insert = () => builder
  builder.single = () => builder
  return builder
}

const makeClient = () => {
  const queues = { collaborators: [], paper_scan_extraction: [] }
  const client = {
    __queues: queues,
    auth: {
      getUser: vi.fn(async () => ({ data: { user: USER }, error: null }))
    },
    from: vi.fn((table) => {
      const response = queues[table]?.shift() ?? null
      return makeBuilder(response)
    }),
    rpc: vi.fn()
  }
  return client
}

const catchError = async (fn) => {
  try {
    await fn()
    return null
  } catch (error) {
    return error
  }
}

const expectAuthError = (error, code, httpStatus) => {
  expect(error).toBeTruthy()
  expect(error.code).toBe(code)
  expect(error.httpStatus).toBe(httpStatus)
}

describe('authenticateExtractionRequest', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('returns 401 when the bearer token is missing', async () => {
    const error = await catchError(() => authenticateExtractionRequest({ accessToken: '', workspaceId: undefined }))
    expectAuthError(error, 'AUTH_REQUIRED', 401)
  })

  it('returns 503 when the server lacks Supabase configuration', async () => {
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_ANON_KEY', '')
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const error = await catchError(() => authenticateExtractionRequest({ accessToken: 'tok', workspaceId: undefined }))
    expectAuthError(error, 'SERVER_NOT_CONFIGURED', 503)
  })

  it('returns 401 when the session token is invalid or expired', async () => {
    const client = makeClient()
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    createClient.mockReturnValue(client)
    const error = await catchError(() => authenticateExtractionRequest({ accessToken: 'bad-token', workspaceId: undefined }))
    expectAuthError(error, 'SESSION_INVALID', 401)
  })

  it('allows an owner to use their own workspace id', async () => {
    const client = makeClient()
    createClient.mockReturnValue(client)
    const result = await authenticateExtractionRequest({ accessToken: 'tok', workspaceId: USER.id })
    expect(result.ownerId).toBe(USER.id)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('defaults to the caller own workspace when none is supplied', async () => {
    const client = makeClient()
    createClient.mockReturnValue(client)
    const result = await authenticateExtractionRequest({ accessToken: 'tok', workspaceId: undefined })
    expect(result.ownerId).toBe(USER.id)
  })

  it('rejects an anonymous identity before any workspace check or claim', async () => {
    const client = makeClient()
    client.auth.getUser.mockResolvedValue({ data: { user: { ...USER, is_anonymous: true } }, error: null })
    createClient.mockReturnValue(client)
    const error = await catchError(() => authenticateExtractionRequest({ accessToken: 'anon-token', workspaceId: undefined }))
    expectAuthError(error, 'ANONYMOUS_NOT_ALLOWED', 403)
    // The failure happens at authentication, so neither the workspace lookup
    // nor any quota RPC path is ever reached.
    expect(client.from).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('allows an active collaborator whose workspace is linked to their user id', async () => {
    const client = makeClient()
    client.__queues.collaborators = [{ data: [{ owner_id: OWNER_ID }], error: null }]
    createClient.mockReturnValue(client)
    const result = await authenticateExtractionRequest({ accessToken: 'tok', workspaceId: OWNER_ID })
    expect(result.ownerId).toBe(OWNER_ID)
  })

  it('falls back to an email match when the collaborator row is not yet linked to a user id', async () => {
    const client = makeClient()
    client.__queues.collaborators = [
      { data: [], error: null },
      { data: [{ owner_id: OWNER_ID }], error: null }
    ]
    createClient.mockReturnValue(client)
    const result = await authenticateExtractionRequest({ accessToken: 'tok', workspaceId: OWNER_ID })
    expect(result.ownerId).toBe(OWNER_ID)
  })

  it('denies a workspace the user does not belong to', async () => {
    const client = makeClient()
    client.__queues.collaborators = [
      { data: [{ owner_id: 'someone-elses-workspace' }], error: null },
      { data: [], error: null }
    ]
    createClient.mockReturnValue(client)
    const error = await catchError(() => authenticateExtractionRequest({ accessToken: 'tok', workspaceId: OWNER_ID }))
    expectAuthError(error, 'WORKSPACE_NOT_AUTHORIZED', 403)
  })

  it('rejects malformed workspace ids', async () => {
    const client = makeClient()
    createClient.mockReturnValue(client)
    const error = await catchError(() => authenticateExtractionRequest({ accessToken: 'tok', workspaceId: 'not-a-uuid' }))
    expectAuthError(error, 'WORKSPACE_NOT_AUTHORIZED', 403)
  })

  it('fails closed when the collaborator query errors', async () => {
    const client = makeClient()
    client.__queues.collaborators = [{ data: null, error: { message: 'db down' } }]
    createClient.mockReturnValue(client)
    const error = await catchError(() => authenticateExtractionRequest({ accessToken: 'tok', workspaceId: OWNER_ID }))
    expectAuthError(error, 'WORKSPACE_CHECK_UNAVAILABLE', 503)
  })
})

describe('claimImageSlot', () => {
  it('claims a fresh extraction through the RPC and returns its id', async () => {
    const client = makeClient()
    client.rpc.mockResolvedValue({ data: [{ status: 'claimed', extraction_id: 'extraction-1' }], error: null })
    const result = await claimImageSlot({ supabase: client, user: USER, ownerId: OWNER_ID, sha256: SHA, requestId: REQUEST_ID })
    expect(result.extractionId).toBe('extraction-1')
    expect(client.rpc).toHaveBeenCalledWith('claim_paper_scan_extraction', {
      p_owner_id: OWNER_ID,
      p_request_id: REQUEST_ID,
      p_image_sha256: SHA
    })
  })

  it('maps a duplicate request id to a 409', async () => {
    const client = makeClient()
    client.rpc.mockResolvedValue({ data: [{ status: 'duplicate', extraction_id: null }], error: null })
    const error = await catchError(() => claimImageSlot({ supabase: client, user: USER, ownerId: OWNER_ID, sha256: SHA, requestId: REQUEST_ID }))
    expectAuthError(error, 'DUPLICATE_REQUEST', 409)
  })

  it('maps quota exhaustion to a 429', async () => {
    const client = makeClient()
    client.rpc.mockResolvedValue({ data: [{ status: 'quota_exceeded', extraction_id: null }], error: null })
    const error = await catchError(() => claimImageSlot({ supabase: client, user: USER, ownerId: OWNER_ID, sha256: SHA, requestId: REQUEST_ID }))
    expectAuthError(error, 'QUOTA_EXCEEDED', 429)
  })

  it('fails closed when the RPC errors', async () => {
    const client = makeClient()
    client.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const error = await catchError(() => claimImageSlot({ supabase: client, user: USER, ownerId: OWNER_ID, sha256: SHA, requestId: REQUEST_ID }))
    expectAuthError(error, 'QUOTA_UNAVAILABLE', 503)
  })

  it('fails closed on an unexpected RPC result', async () => {
    const client = makeClient()
    client.rpc.mockResolvedValue({ data: [{ status: 'something_else', extraction_id: null }], error: null })
    const error = await catchError(() => claimImageSlot({ supabase: client, user: USER, ownerId: OWNER_ID, sha256: SHA, requestId: REQUEST_ID }))
    expectAuthError(error, 'QUOTA_UNAVAILABLE', 503)
  })

  it('requires a valid payload including a request id', async () => {
    const client = makeClient()
    const error = await catchError(() => claimImageSlot({ supabase: client, user: USER, ownerId: OWNER_ID, sha256: SHA, requestId: '' }))
    expectAuthError(error, 'MISSING_IMAGE', 400)
  })
})

describe('readWorkspaceId', () => {
  it('reads the workspace from the X-DatSer-Workspace-Id header', () => {
    expect(readWorkspaceId({ headers: { 'x-datser-workspace-id': OWNER_ID } })).toBe(OWNER_ID)
    expect(readWorkspaceId({ headers: { 'X-DatSer-Workspace-Id': OWNER_ID } })).toBe(OWNER_ID)
    expect(readWorkspaceId({ headers: {} })).toBe('')
    expect(readWorkspaceId({})).toBe('')
  })
})

describe('readBearerToken', () => {
  it('extracts a bearer token from the authorization header', () => {
    expect(readBearerToken({ headers: { authorization: 'Bearer abc.def.ghi' } })).toBe('abc.def.ghi')
    expect(readBearerToken({ headers: { Authorization: 'bearer xyz' } })).toBe('xyz')
    expect(readBearerToken({ headers: { authorization: 'Basic abc' } })).toBe('')
    expect(readBearerToken({ headers: {} })).toBe('')
    expect(readBearerToken({})).toBe('')
  })
})