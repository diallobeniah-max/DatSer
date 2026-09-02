import { test, expect } from '@playwright/test'

const rows = Array.from({ length: 30 }, (_, index) => (
  `Sheet 1,${index + 1},Synthetic Scroll ${index + 1},024000${String(index).padStart(4, '0')},${13 + (index % 6)},${index % 2 ? 'Male' : 'Female'},JHS 3,P,,,,,`
))
const csv = [
  'sheet,row_number,full_name,phone_number,age,gender,educational_level,sunday_1,sunday_2,sunday_3,sunday_4,sunday_5,notes',
  ...rows,
].join('\n')
const sourceImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="100%" height="100%" fill="#0f766e"/><text x="32" y="64" fill="white" font-size="24">CSV source</text></svg>')

const scrollOwnerTop = (locator) => locator.evaluate((element) => {
  let ancestor = element.parentElement
  while (ancestor) {
    const style = getComputedStyle(ancestor)
    if (['auto', 'scroll', 'overlay'].includes(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight) return ancestor.scrollTop
    ancestor = ancestor.parentElement
  }
  return document.scrollingElement?.scrollTop ?? 0
})

const wheelOver = async (page, locator) => {
  await locator.scrollIntoViewIfNeeded()
  await locator.hover()
  const before = await scrollOwnerTop(locator)
  await page.mouse.wheel(0, 360)
  await expect.poll(() => scrollOwnerTop(locator), { timeout: 2000 }).toBeGreaterThan(before)
}

test('CSV review wheel scrolls its actual vertical owner while preserving image zoom and horizontal trackpad scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 })
  await page.goto('/')
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function')
  const dismiss = page.getByRole('button', { name: 'Dismiss compact UI suggestion' })
  if (await dismiss.isVisible()) await dismiss.click()
  await page.evaluate(() => window.openSettings?.())
  await page.getByRole('button', { name: /CSV Import/i }).first().click()
  await page.getByRole('button', { name: /Full Register/i }).click()

  const imageChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Attach source images' }).click()
  await (await imageChooser).setFiles({ name: 'sheet-1.svg', mimeType: 'image/svg+xml', buffer: sourceImage })
  const csvChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload .csv file' }).click()
  await (await csvChooser).setFiles({ name: 'scroll.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  await expect(page.getByRole('heading', { name: 'Review Import Data' })).toBeVisible()
  const firstRow = page.locator('tbody tr').first()
  const cells = firstRow.locator('td')

  await wheelOver(page, cells.nth(2)) // Name
  await wheelOver(page, cells.nth(4)) // Status
  await wheelOver(page, cells.nth(5)) // Phone
  await wheelOver(page, cells.nth(11)) // S1

  const tableScroll = page.locator('[data-review-horizontal-scroll]').last()
  await tableScroll.scrollIntoViewIfNeeded()
  await tableScroll.evaluate((element) => { element.scrollLeft = 0 })
  await tableScroll.hover()
  const horizontalBefore = await tableScroll.evaluate((element) => element.scrollLeft)
  await page.mouse.wheel(420, 8)
  await expect.poll(() => tableScroll.evaluate((element) => element.scrollLeft), { timeout: 2000 }).toBeGreaterThan(horizontalBefore)
  await expect(tableScroll).toHaveClass(/overflow-x-auto/)

  await page.getByRole('button', { name: 'Comfortable' }).click()
  await wheelOver(page, firstRow.locator('td').nth(2))
  await page.getByRole('button', { name: 'Compact' }).click()
  await wheelOver(page, firstRow.locator('td').nth(2))

  await page.getByRole('button', { name: 'Compare source' }).click()
  const reviewOwner = page.locator('[data-review-vertical-scroll-owner]')
  const viewport = page.locator('[data-source-image-viewport]')
  const image = viewport.locator('img')
  await expect(image).toBeVisible()
  const ownerBeforeImageWheel = await reviewOwner.evaluate((element) => element.scrollTop)
  const transformBeforeImageWheel = await image.evaluate((element) => element.style.transform)
  await viewport.hover()
  await page.mouse.wheel(0, -260)
  await expect.poll(() => image.evaluate((element) => element.style.transform), { timeout: 2000 }).not.toBe(transformBeforeImageWheel)
  await expect(reviewOwner).toHaveJSProperty('scrollTop', ownerBeforeImageWheel)

  const compareRow = reviewOwner.locator('tbody tr').first()
  await wheelOver(page, compareRow.locator('td').nth(2))
})
