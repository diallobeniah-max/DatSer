import { test, expect } from '@playwright/test'

test.describe('Synthetic live-service browser simulation', () => {
  test('attendance remains instant through offline and reconnect transitions', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('datser_search_suggestion_prompt_seen_v1', 'true')
      localStorage.setItem('datser_compact_suggestion_dismissed_at', String(Date.now()))
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByTestId('dev-login-button').click()
    await page.waitForFunction(() => typeof window.openSettings === 'function', null, { timeout: 30000 })
    await expect(page.locator('.member-card').first()).toBeVisible()

    const firstCard = page.locator('.member-card').first()
    const present = firstCard.getByTestId(/member-card-attendance-.*-present/)
    await present.click()
    const missingModal = page.getByTestId('missing-data-modal')
    if (await missingModal.isVisible().catch(() => false)) {
      await missingModal.getByRole('button', { name: /override/i }).click()
      const parentName = missingModal.getByPlaceholder('Enter parent/guardian name')
      if (await parentName.isVisible().catch(() => false)) {
        await parentName.fill('Synthetic Guardian')
      }
      const noPhone = missingModal.getByRole('button', { name: 'No Phone', exact: true })
      if (await noPhone.isVisible().catch(() => false)) await noPhone.click()
      await missingModal.getByRole('button', { name: /^save/i }).click()
      await expect(missingModal).toHaveCount(0)
    }
    await expect(present).toHaveAttribute('data-selected', 'true')

    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await firstCard.locator('.member-card-header').click()
    const datedChoice = firstCard.locator('.member-card-expanded .attendance-choice').first()
    const datedAbsent = datedChoice.getByRole('button', { name: 'A', exact: true })
    await datedAbsent.click()
    await expect(datedAbsent).toHaveAttribute('data-selected', 'true')
    await expect(datedChoice).toHaveAttribute('data-state', /idle|queued/)

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(datedAbsent).toHaveAttribute('data-selected', 'true')
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('synthetic add and edit forms preserve responsive action access', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByTestId('dev-login-button').click()
    await page.waitForFunction(() => typeof window.openAddMember === 'function', null, { timeout: 30000 })
    await page.evaluate(() => window.openAddMember?.())

    const modal = page.getByTestId('add-member-modal')
    await modal.getByPlaceholder('Enter full name').fill('Synthetic Reliability Member')
    await modal.getByText('Female', { exact: true }).click()
    await expect(modal.locator('.keyboard-safe-modal-footer')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Add Member', exact: true })).toBeEnabled()
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(modal).toHaveCount(0)
  })
})
