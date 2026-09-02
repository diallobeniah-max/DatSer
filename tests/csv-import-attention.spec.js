import { test, expect } from '@playwright/test'

const outputDir = 'C:/Users/wonde/.codex/visualizations/2026/08/14/01a001ed-2eb6-70c0-a405-1cf242f88351'

test('CSV Needs Attention review, preview gate, verification, and responsive UI', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function', null, { timeout: 30000 })
  const compactDismiss = page.getByRole('button', { name: 'Dismiss compact UI suggestion' })
  if (await compactDismiss.isVisible()) await compactDismiss.click()
  await page.evaluate(() => window.openSettings?.())
  await page.getByRole('button', { name: /CSV Import/i }).first().click()
  await expect(page.getByRole('heading', { name: 'CSV Import' }).first()).toBeVisible()

  await page.getByRole('button', { name: /Full Register/i }).click()
  const csv = [
    'sheet,row_number,full_name,phone_number,age,gender,educational_level,sunday_1,sunday_2,sunday_3,sunday_4,sunday_5,notes',
    'Sheet 1,1,Synthetic Attention,0240000001,14,Female,JHS 3,P,,,,,Phone handwriting should be reviewed',
    'Sheet 1,2,Synthetic Clear,0240000002,15,Male,JHS 3,P,,,,,',
  ].join('\n')
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload .csv file' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: 'needs-attention.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  await expect(page.getByRole('heading', { name: 'Review Import Data' })).toBeVisible({ timeout: 30000 })
  const attentionCard = page.getByRole('button', { name: /1\s*Needs Attention/i })
  await expect(attentionCard).toBeVisible()
  await attentionCard.click()
  await page.getByPlaceholder(/Search name, phone, code/i).fill('Synthetic Attention')
  const attentionRow = page.getByRole('row', { name: /Synthetic Attention/ })
  await expect(attentionRow.getByRole('textbox').first()).toHaveValue('Synthetic Attention')
  await page.getByRole('button', { name: /Review note for Synthetic Attention/i }).click()
  await expect(page.getByText('Phone handwriting should be reviewed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark Verified' })).toBeVisible()
  await page.screenshot({ path: `${outputDir}/csv-needs-attention-desktop.png`, fullPage: true })

  await page.getByRole('button', { name: /Next: Month/i }).click()
  await page.getByRole('button', { name: /^Preview/i }).last().click()
  await expect(page.getByText(/1 row still need verification/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Save 1 Row/i })).toBeVisible()
  await page.getByRole('button', { name: /Return to review/i }).click()

  await expect(page.getByText('Phone handwriting should be reviewed', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Mark Verified' }).click()
  await expect(page.getByRole('button', { name: /0\s*Needs Attention/i })).toBeVisible()
  await page.getByRole('button', { name: /2\s*All/i }).click()
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Phone handwriting should be reviewed', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /Full Register/i }).click()
  const mobileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload .csv file' }).click()
  const mobileChooser = await mobileChooserPromise
  await mobileChooser.setFiles({ name: 'needs-attention.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('heading', { name: 'Review Import Data' })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /1\s*Needs Attention/i }).click()
  await page.getByRole('button', { name: /Review note for Synthetic Attention/i }).click()
  await expect(page.getByRole('button', { name: 'Mark Verified' })).toBeVisible()
  await page.screenshot({ path: `${outputDir}/csv-needs-attention-mobile.png`, fullPage: true })
  expect(pageErrors).toEqual([])
})
