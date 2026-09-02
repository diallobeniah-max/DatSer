import { test, expect } from '@playwright/test'

test('CSV review shows conservative bulk-create counts and requires confirmation', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function')
  const dismiss = page.getByRole('button', { name: 'Dismiss compact UI suggestion' })
  if (await dismiss.isVisible()) await dismiss.click()
  await page.evaluate(() => window.openSettings?.())
  await page.getByRole('button', { name: /CSV Import/i }).first().click()
  await page.getByRole('button', { name: /Full Register/i }).click()

  const csv = [
    'sheet,row_number,full_name,phone_number,age,gender,educational_level,notes',
    'Sheet 4,7,Bulk Create Synthetic 5821,0240005821,16,Male,JHS 3,',
    'Sheet 4,8,Bulk Attention Synthetic 5822,0240005822,16,Female,JHS 3,Verify handwriting',
  ].join('\n')
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload .csv file' }).click()
  await (await chooserPromise).setFiles({ name: 'bulk-create.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  await expect(page.getByRole('heading', { name: 'Review Import Data' })).toBeVisible({ timeout: 30000 })
  const readiness = page.getByLabel('Bulk member creation readiness')
  await expect(readiness.getByText('1 safe new', { exact: true })).toBeVisible()
  await expect(readiness.getByText('1 need attention', { exact: true })).toBeVisible()

  await readiness.getByRole('button', { name: /Create 1 safe new member/i }).click()
  const dialog = page.getByRole('dialog', { name: /Create 1 new member/i })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/No attendance will be marked/i)).toBeVisible()
  await expect(dialog.getByText(/1 attention or invalid rows are excluded/i)).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
