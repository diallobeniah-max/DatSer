import { test, expect } from '@playwright/test'

test('Process Remaining Sheets batch fast import workflow and confirmation preview', async ({ page }) => {
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
  await page.getByRole('button', { name: /Full Register/i }).click()

  const csvSheet1 = [
    'sheet,row_number,full_name,phone_number,age,gender,educational_level,sunday_1,sunday_2,sunday_3,sunday_4,sunday_5,notes',
    'Sheet 1,1,Process Safe Alpha,0240001001,16,Male,JHS 3,P,A,,,,',
    'Sheet 1,2,Process Attention Beta,0240001002,17,Female,JHS 3,P,,,,,Handwriting uncertain',
  ].join('\n')

  const chooserPromise1 = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload .csv file' }).click()
  await (await chooserPromise1).setFiles({ name: 'Sheet 1.csv', mimeType: 'text/csv', buffer: Buffer.from(csvSheet1) })
  await expect(page.getByRole('heading', { name: 'Review Import Data' })).toBeVisible({ timeout: 30000 })

  const readiness = page.getByLabel('Bulk member creation readiness')
  await expect(readiness.getByText('1 safe new', { exact: true })).toBeVisible()
  await expect(readiness.getByText('1 need attention', { exact: true })).toBeVisible()
})
