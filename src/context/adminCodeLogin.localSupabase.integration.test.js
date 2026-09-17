import { describe, expect, it } from 'vitest'
import { readLocalSupabase } from '../experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'

// This test is intentionally opt-in: it proves the local Edge Runtime route is
// available without using a real admin code or any hosted Supabase project.
const describeLocal = process.env.DATSER_RUN_LOCAL_ADMIN_LOGIN_TEST === 'true' ? describe : describe.skip

describeLocal('local Admin Access Edge Function', () => {
  it('serves a safe invalid-code response through the local function route', async () => {
    const { url, anonKey } = readLocalSupabase()
    const parsedUrl = new URL(url)

    expect(parsedUrl.protocol).toBe('http:')
    expect(['127.0.0.1', 'localhost']).toContain(parsedUrl.hostname)

    const response = await fetch(`${url}/functions/v1/admin-code-login`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ code: 'synthetic-invalid-admin-code' })
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid admin code' })
  })
})
