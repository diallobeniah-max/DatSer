import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'real-member-v2-offline.spec.js',
  timeout: 90000,
  fullyParallel: false,
  outputDir: 'output/playwright/real-member-v2',
  use: { baseURL: process.env.PLAYWRIGHT_REAL_MEMBER_V2_URL || 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
