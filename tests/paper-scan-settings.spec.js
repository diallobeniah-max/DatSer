import { test, expect } from '@playwright/test'

test('Paper Scan usage and storage are visible and honest in Settings Storage & Limits', async ({ page }) => {
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.addInitScript(() => {
    localStorage.setItem('datser_search_suggestion_prompt_seen_v1', 'true')
    localStorage.setItem('datser_compact_suggestion_dismissed_at', String(Date.now()))
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function')
  await page.evaluate(() => window.openSettings?.())
  await page.getByRole('button', { name: /^Storage & Limits/ }).first().click()

  const panel = page.getByRole('region', { name: 'Storage and limits' })
  await expect(panel).toBeVisible()
  await page.locator('.Toastify').evaluateAll((nodes) => nodes.forEach((node) => { node.style.display = 'none' }))
  await panel.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(100)

  await expect(panel.getByText('Database Storage', { exact: true })).toBeVisible()
  await expect(panel.getByText('File Storage', { exact: true })).toBeVisible()
  await expect(panel.getByText('Saved Scan Storage', { exact: true })).toBeVisible()
  await expect(panel.getByText('Gemini', { exact: true })).toBeVisible()
  await expect(panel.getByText(/Remaining quota: Not available from provider/i)).toBeVisible()
  await expect(panel.getByText(/View live limits in Google AI Studio/i)).toBeVisible()
  await expect(panel.getByText(/No Alibaba\/Qwen integration is present/i)).toBeVisible()
  await expect(panel.getByText('Auth Emails', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: /Refresh usage/i })).toBeVisible()
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
  expect(consoleErrors).toEqual([])
  await panel.screenshot({ path: 'C:/Users/wonde/Documents/ChatGPT/Tempt/paper-scan-settings-desktop.png' })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel).toBeVisible()
  await panel.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(100)
  await panel.screenshot({ path: 'C:/Users/wonde/Documents/ChatGPT/Tempt/paper-scan-settings-mobile.png' })
})

test('Offline sync health stays in Settings Search & Data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('datser_search_suggestion_prompt_seen_v1', 'true')
    localStorage.setItem('datser_compact_suggestion_dismissed_at', String(Date.now()))
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function')
  await page.evaluate(() => window.openSettings?.())
  await page.getByRole('button', { name: /^Search & Data/ }).first().click()

  const panel = page.getByRole('region', { name: 'Offline sync health' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/does not retry, clear, or refactor the offline engine/i)).toBeVisible()
})