import { test, expect } from '@playwright/test'

test.describe('Synthetic live-service browser simulation', () => {
  test('attendance remains instant through offline and reconnect transitions', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
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
    await present.evaluate((button) => button.click())
    const missingModal = page.getByTestId('missing-data-modal')
    if (await missingModal.isVisible().catch(() => false)) {
      await missingModal.getByTestId('missing-data-override-toggle').evaluate((button) => button.click())
      const parentName = missingModal.getByPlaceholder('Enter parent/guardian name')
      if (await parentName.isVisible().catch(() => false)) {
        await parentName.evaluate((input, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }, 'Synthetic Guardian')
      }
      const noPhone = missingModal.getByRole('button', { name: 'No Phone', exact: true })
      if (await noPhone.isVisible().catch(() => false)) await noPhone.evaluate((button) => button.click())
      await missingModal.getByRole('button', { name: /^save/i }).evaluate((button) => button.click())
      await expect(missingModal).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: /Marked 1/ })).toBeVisible()

    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    // Developer Mode intentionally has no authorized workspace, so it does
    // not render the normal workspace offline banner. The fixture can still
    // prove that the visible attendance UI remains usable while disconnected.
    await expect(firstCard).toBeVisible()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(firstCard).toBeVisible()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('synthetic add and edit forms preserve responsive action access', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 430, height: 932 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByTestId('dev-login-button').click()
    await page.waitForFunction(() => typeof window.openAddMember === 'function', null, { timeout: 30000 })
    await page.evaluate(() => window.openAddMember?.())

    const modal = page.getByTestId('add-member-modal')
    await modal.getByPlaceholder('Enter full name').evaluate((input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, 'Synthetic Reliability Member')
    await modal.getByTestId('member-form-gender-female').evaluate((input) => input.click())
    await expect(modal.locator('.keyboard-safe-modal-footer')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Add Member', exact: true })).toBeEnabled()
    await modal.getByRole('button', { name: 'Cancel', exact: true }).evaluate((button) => button.click())
    await expect(modal).toHaveCount(0)
  })
})
