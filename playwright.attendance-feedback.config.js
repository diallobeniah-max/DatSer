import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'attendance-feedback.spec.js',
  timeout: 30000,
  workers: 1,
  outputDir: 'output/playwright/attendance-feedback',
  use: { baseURL: 'http://127.0.0.1:5191', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5191 --strictPort',
    url: 'http://127.0.0.1:5191',
    reuseExistingServer: true,
    timeout: 120000,
  },
})
