import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { acquireLocalSupabaseIntegrationLock, readLocalSupabase } from '../rxdb-backend-poc/testing/localSupabaseFixture'

const createdUserIds = []
let releaseLocalSupabaseLock

beforeAll(async () => { releaseLocalSupabaseLock = await acquireLocalSupabaseIntegrationLock() }, 180000)
afterAll(async () => { await releaseLocalSupabaseLock?.() })

afterEach(async () => {
  if (!createdUserIds.length) return
  const config = readLocalSupabase()
  const admin = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await Promise.all(createdUserIds.splice(0).map((userId) => admin.auth.admin.deleteUser(userId)))
})

describe.sequential('local Member V2 signup', () => {
  it('creates a local user and returns a signed-in session when confirmation is disabled', async () => {
    const config = readLocalSupabase()
    const client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const email = `member-v2-signup-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@local.invalid`
    const password = `MemberV2-${crypto.randomUUID()}-9a!`

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'http://localhost',
        data: { full_name: 'Synthetic Android Signup' },
      },
    })

    expect(error).toBeNull()
    expect(data.user?.id).toBeTruthy()
    expect(data.session?.access_token).toBeTruthy()
    createdUserIds.push(data.user.id)
  })
})
