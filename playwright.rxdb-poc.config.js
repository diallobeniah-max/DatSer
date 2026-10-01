import { defineConfig, devices } from '@playwright/test'
import { readLocalSupabase } from './src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'

const local = readLocalSupabase()
process.env.VITE_RXDB_POC_SUPABASE_URL = local.url
process.env.VITE_RXDB_POC_SUPABASE_ANON_KEY = local.anonKey

export default defineConfig({
  testDir: './tests', testMatch: 'rxdb-poc.integration.spec.js', timeout: 60000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4175', url: 'http://127.0.0.1:4175/rxdb-poc.html', reuseExistingServer: false, timeout: 120000 }
})
