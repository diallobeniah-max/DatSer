import { expect, test } from '@playwright/test'

test('isolated Member V2 route is available without mounting production member screens', async ({ page }) => {
  await page.goto('/rxdb-member-phase1.html')
  await expect(page.getByRole('heading', { name: 'DatSer Member V2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open local workspace' })).toBeVisible()
  await expect(page.getByText('Isolated Phase 1 client harness')).toBeVisible()
})
