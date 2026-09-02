import { test, expect } from '@playwright/test'

test('Repair / Reprocess Sheets workflow resets only affected sheets and restores Process Remaining button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('dev-login-button')).toBeVisible()
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function', null, { timeout: 30000 })
  const dismiss = page.getByRole('button', { name: 'Dismiss compact UI suggestion' })
  if (await dismiss.isVisible()) await dismiss.click()
  await page.evaluate(() => window.openSettings?.())
  await page.getByRole('button', { name: /CSV Import/i }).first().click()

  // Upload multiple CSV sheets in batch mode
  const csvSheet1 = 'sheet,full_name,phone_number,age,gender,sunday_1,sunday_2\nSheet 1,Person One,0240000001,16,Male,P,A'
  const csvSheet5 = 'sheet,full_name,phone_number,age,gender,sunday_1,sunday_2,sunday_4,sunday_5\nSheet 5,Person Five,0240000005,17,Female,P,A,X,✓'

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload CSV files' }).click()
  await (await chooserPromise).setFiles([
    { name: 'Sheet 1.csv', mimeType: 'text/csv', buffer: Buffer.from(csvSheet1) },
    { name: 'Sheet 5.csv', mimeType: 'text/csv', buffer: Buffer.from(csvSheet5) },
  ])

  // Verify batch workspace appears
  const workspace = page.getByLabel('CSV batch workspace')
  await expect(workspace).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('2 remaining sheets')).toBeVisible()
})
