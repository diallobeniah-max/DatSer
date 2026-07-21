import { test, expect } from '@playwright/test'

const enterSyntheticWorkspace = async (page, { width, height, dark = false } = {}) => {
  await page.setViewportSize({ width, height })
  await page.addInitScript(({ darkMode }) => {
    localStorage.setItem('datser_search_suggestion_prompt_seen_v1', 'true')
    localStorage.setItem('datser_compact_suggestion_dismissed_at', String(Date.now()))
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, { darkMode: dark })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function', null, { timeout: 30000 })
  await page.locator('.Toastify').evaluateAll((nodes) => nodes.forEach((node) => { node.style.display = 'none' }))
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      .Toastify { display: none !important; }
    `
  })
  if (dark) {
    await page.evaluate(() => document.documentElement.classList.add('dark'))
  }
}

test.describe('DatSer visual regression', () => {
  test('mobile dashboard and expanded member stay consistent in light mode', async ({ page }) => {
    await enterSyntheticWorkspace(page, { width: 390, height: 844 })
    const shell = page.locator('.dashboard-app-shell')
    await expect(shell).toHaveScreenshot('mobile-dashboard-light.png', { animations: 'disabled' })

    await page.locator('.member-card-header').first().click()
    await expect(page.locator('.member-card').first()).toHaveScreenshot('mobile-member-expanded-light.png', { animations: 'disabled' })
  })

  test('mobile Add Member sheet stays consistent in dark mode', async ({ page }) => {
    await enterSyntheticWorkspace(page, { width: 430, height: 932, dark: true })
    await page.evaluate(() => window.openAddMember?.())
    const modal = page.getByTestId('add-member-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toHaveScreenshot('mobile-add-member-dark.png', { animations: 'disabled' })
  })

  test('desktop dashboard stays aligned in light mode', async ({ page }) => {
    await enterSyntheticWorkspace(page, { width: 1440, height: 900 })
    await expect(page.locator('.dashboard-app-shell')).toHaveScreenshot('desktop-dashboard-light.png', { animations: 'disabled' })
  })

  test('desktop dashboard stays aligned in dark mode', async ({ page }) => {
    await enterSyntheticWorkspace(page, { width: 1440, height: 900, dark: true })
    await expect(page.locator('.dashboard-app-shell')).toHaveScreenshot('desktop-dashboard-dark.png', { animations: 'disabled' })
  })
})
