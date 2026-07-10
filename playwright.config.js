import { defineConfig, devices } from '@playwright/test';

const usePreviewServer = process.env.PLAYWRIGHT_USE_PREVIEW === '1';
const previewPort = Number(process.env.PLAYWRIGHT_PREVIEW_PORT || 4173);
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  use: {
    baseURL: usePreviewServer ? previewUrl : 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: usePreviewServer
      ? `npm run preview -- --host 127.0.0.1 --port ${previewPort}`
      : 'npm run dev',
    url: usePreviewServer ? previewUrl : 'http://localhost:3000',
    reuseExistingServer: !usePreviewServer,
    timeout: 120000,
  },
});
