import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'real-member-v2-offline.spec.js',
  timeout: 90000,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
