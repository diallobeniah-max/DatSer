import { defineConfig, devices } from '@playwright/test'
import { readLocalSupabase } from './src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'

const local = readLocalSupabase()
const localUrl = new URL(local.url)
if (!['127.0.0.1', 'localhost'].includes(localUrl.hostname)) {
  throw new Error('The Member V2 browser gate requires local Supabase.')
}
process.env.DATSER_LOCAL_SUPABASE_URL = local.url
process.env.DATSER_LOCAL_SUPABASE_ANON_KEY = local.anonKey
process.env.DATSER_LOCAL_SUPABASE_SERVICE_ROLE_KEY = local.serviceKey

export default defineConfig({
  testDir: './tests',
  testMatch: ['real-member-v2-offline.spec.js', 'member-v2-hosted-routing.spec.js'],
  timeout: 90000,
  fullyParallel: false,
  outputDir: process.env.DATSER_MEMBER_V2_BROWSER_OUTPUT_DIR || 'output/playwright/real-member-v2',
  use: { baseURL: process.env.PLAYWRIGHT_REAL_MEMBER_V2_URL || 'http://127.0.0.1:5176', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
