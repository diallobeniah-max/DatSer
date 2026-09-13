import { defineConfig, devices } from '@playwright/test'
import { readLocalSupabase } from './src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'

const local = readLocalSupabase()
process.env.VITE_RXDB_MEMBER_V2_SUPABASE_URL = local.url
process.env.VITE_RXDB_MEMBER_V2_SUPABASE_ANON_KEY = local.anonKey

export default defineConfig({
  testDir: './tests', testMatch: 'rxdb-member-phase1.spec.js', timeout: 60000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4176', trace: 'on-first-retry' }, projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4176', url: 'http://127.0.0.1:4176/rxdb-member-phase1.html', reuseExistingServer: false, timeout: 120000 },
})
