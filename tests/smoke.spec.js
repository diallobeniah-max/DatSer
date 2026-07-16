import { test, expect } from '@playwright/test'

const isPreviewSmoke = process.env.PLAYWRIGHT_USE_PREVIEW === '1'

const loginWithDeveloperMode = async (page) => {
  await expect(page.getByTestId('dev-login-button')).toBeVisible()
  await page.getByTestId('dev-login-button').click()
  await page.waitForFunction(() => typeof window.openSettings === 'function', null, { timeout: 30000 })
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
}

const openDeveloperMode = async (page) => {
  await page.evaluate(() => {
    window.openSettings?.()
  })
  const developerModeEntry = page.getByRole('button', { name: /developer mode/i }).filter({ hasText: /open risky flows quickly|launch flows quickly/i }).first()
  try {
    await expect(developerModeEntry).toBeVisible({ timeout: 5000 })
  } catch {
    const settingsButton = page.getByRole('button', { name: /^settings$/i }).first()
    if (await settingsButton.isVisible()) {
      await settingsButton.click()
    }
    await expect(developerModeEntry).toBeVisible()
  }
  await developerModeEntry.click()
  await expect(page.getByRole('heading', { name: 'Developer Mode' }).first()).toBeVisible()
}

test.describe('Preflight smoke', () => {
  test.beforeEach(async ({ page }) => {
    const pageErrors = []
    const consoleErrors = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    page.setExtraHTTPHeaders({ 'x-datser-smoke': '1' })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    test.info().annotations.push({
      type: 'pageErrors',
      description: JSON.stringify(pageErrors)
    })

    test.info().annotations.push({
      type: 'consoleErrors',
      description: JSON.stringify(consoleErrors)
    })
  })

  test('loads the login screen without crashing', async ({ page }) => {
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()
    await expect(page.locator('input[type="email"]').first()).toBeVisible()
  })

  test('core auth actions render and stay interactive', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: /^sign in$/i }).last()
    const googleButton = page.getByRole('button', { name: /continue with google/i })
    const emailInput = page.locator('input[type="email"]').first()

    await emailInput.fill('smoke@example.com')
    await expect(emailInput).toHaveValue('smoke@example.com')
    await expect(signInButton).toBeVisible()
    await expect(googleButton).toBeVisible()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('production smoke hides local developer mode entry', async ({ page }) => {
    test.skip(!isPreviewSmoke, 'Developer button is intentionally available only in local dev smoke runs.')
    await expect(page.getByTestId('dev-login-button')).toHaveCount(0)
    await expect(page.getByText('Enter Developer Mode')).toHaveCount(0)
  })

  test('dashboard app shell keeps navigation and search dock anchored', async ({ page }, testInfo) => {
    test.skip(isPreviewSmoke, 'Developer bypass is intentionally disabled in preview/prod smoke runs.')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loginWithDeveloperMode(page)

    const shell = page.locator('.dashboard-app-shell')
    const header = page.locator('.app-header')
    const content = page.locator('.dashboard-app-content')
    const dock = page.locator('.app-bottom-dock')
    const search = dock.getByPlaceholder(/search members/i)

    await expect(shell).toBeVisible()
    await expect(header).toBeVisible()
    await expect(content).toBeVisible()
    await expect(dock).toBeVisible()
    await expect(search).toBeVisible()

    const initialLayout = await page.evaluate(() => {
      const shellElement = document.querySelector('.dashboard-app-shell')
      const headerElement = document.querySelector('.app-header')
      const contentElement = document.querySelector('.dashboard-app-content')
      const dockElement = document.querySelector('.app-bottom-dock')
      const inputElement = dockElement?.querySelector('input')
      const rect = (element) => element?.getBoundingClientRect().toJSON()

      return {
        bodyOverflow: getComputedStyle(document.body).overflow,
        shellPosition: getComputedStyle(shellElement).position,
        shellOverflow: getComputedStyle(shellElement).overflow,
        headerPosition: getComputedStyle(headerElement).position,
        contentOverflowY: getComputedStyle(contentElement).overflowY,
        dockPosition: getComputedStyle(dockElement).position,
        inputFontSize: Number.parseFloat(getComputedStyle(inputElement).fontSize),
        headerRect: rect(headerElement),
        dockRect: rect(dockElement),
      }
    })

    expect(initialLayout.bodyOverflow).toBe('hidden')
    expect(initialLayout.shellPosition).toBe('fixed')
    expect(initialLayout.shellOverflow).toBe('hidden')
    expect(initialLayout.headerPosition).toBe('relative')
    expect(initialLayout.contentOverflowY).toBe('auto')
    expect(initialLayout.dockPosition).toBe('absolute')
    expect(initialLayout.inputFontSize).toBeGreaterThanOrEqual(16)

    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.waitForTimeout(100)

    const scrolledLayout = await page.evaluate(() => ({
      headerRect: document.querySelector('.app-header')?.getBoundingClientRect().toJSON(),
      dockRect: document.querySelector('.app-bottom-dock')?.getBoundingClientRect().toJSON(),
    }))

    expect(Math.abs(scrolledLayout.headerRect.top - initialLayout.headerRect.top)).toBeLessThan(1)
    expect(Math.abs(scrolledLayout.dockRect.bottom - initialLayout.dockRect.bottom)).toBeLessThan(1)

    const scrollTopBeforeFocus = await content.evaluate((element) => element.scrollTop)
    await search.focus()
    const focusLayout = await page.evaluate(() => ({
      windowScrollY: window.scrollY,
      contentScrollTop: document.querySelector('.dashboard-app-content')?.scrollTop,
    }))
    expect(focusLayout.windowScrollY).toBe(0)
    expect(focusLayout.contentScrollTop).toBe(scrollTopBeforeFocus)

    await search.fill('John')
    await expect(search).toHaveValue('John')

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--app-visual-height', '520px')
    })
    await page.waitForTimeout(100)

    const keyboardLayout = await page.evaluate(() => ({
      shellHeight: document.querySelector('.dashboard-app-shell')?.getBoundingClientRect().height,
      dockBottom: document.querySelector('.app-bottom-dock')?.getBoundingClientRect().bottom,
      shellBottom: document.querySelector('.dashboard-app-shell')?.getBoundingClientRect().bottom,
    }))

    expect(Math.abs(keyboardLayout.shellHeight - 520)).toBeLessThan(1)
    expect(Math.abs(keyboardLayout.dockBottom - keyboardLayout.shellBottom)).toBeLessThan(1)

    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--app-visual-height')
    })
    await search.fill('')
    const compactDismiss = page.getByRole('button', { name: /dismiss compact ui suggestion/i })
    if (await compactDismiss.isVisible().catch(() => false)) {
      await compactDismiss.click()
    }
    const toastCloseButtons = page.locator('.Toastify__close-button')
    for (let index = (await toastCloseButtons.count()) - 1; index >= 0; index -= 1) {
      const closeButton = toastCloseButtons.nth(index)
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click()
      }
    }
    await page.waitForTimeout(250)

    const responsiveViewports = [
      { name: 'iphone-se', width: 320, height: 568 },
      { name: 'iphone', width: 390, height: 844 },
      { name: 'iphone-pro-max', width: 430, height: 932 },
      { name: 'android', width: 412, height: 915 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1440, height: 900 },
    ]

    for (const viewport of responsiveViewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.waitForTimeout(100)
      const layout = await page.evaluate(() => {
        const shellElement = document.querySelector('.dashboard-app-shell')
        const headerElement = document.querySelector('.app-header')
        const contentElement = document.querySelector('.dashboard-app-content')
        const dockElement = document.querySelector('.app-bottom-dock')
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          shellRect: shellElement?.getBoundingClientRect().toJSON(),
          headerRect: headerElement?.getBoundingClientRect().toJSON(),
          contentHeight: contentElement?.getBoundingClientRect().height,
          dockRect: dockElement?.getBoundingClientRect().toJSON(),
        }
      })

      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
      expect(layout.headerRect.top).toBeGreaterThanOrEqual(-1)
      expect(layout.contentHeight).toBeGreaterThan(0)
      expect(layout.dockRect.bottom).toBeLessThanOrEqual(layout.shellRect.bottom + 1)
      expect(layout.dockRect.bottom).toBeGreaterThan(layout.shellRect.bottom - 2)

      if (['iphone', 'tablet', 'desktop'].includes(viewport.name)) {
        await page.screenshot({
          path: testInfo.outputPath(`pwa-shell-${viewport.name}.png`),
          fullPage: false,
        })
      }
    }

    await page.evaluate(() => window.openSettings?.())
    await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible()
    const settingsLayout = await page.evaluate(() => ({
      dashboardShellCount: document.querySelectorAll('.dashboard-app-shell').length,
      bodyHasDashboardLock: document.body.classList.contains('dashboard-shell-active'),
      settingsMainVisible: Boolean(document.querySelector('.app-main-settings-safe')),
    }))
    expect(settingsLayout.dashboardShellCount).toBe(0)
    expect(settingsLayout.bodyHasDashboardLock).toBe(false)
    expect(settingsLayout.settingsMainVisible).toBe(true)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('developer mode launches add member and date picking stays stable', async ({ page }) => {
    test.skip(isPreviewSmoke, 'Developer bypass is intentionally disabled in preview/prod smoke runs.')

    await loginWithDeveloperMode(page)

    await page.evaluate(() => window.openAddMember?.())
    await expect(page.getByRole('heading', { name: 'Add New Member' })).toBeVisible()

    await page.getByPlaceholder('Enter full name').fill('Smoke Member')
    await page.getByText('Female').click()
    await page.getByTestId('member-form-level-toggle').click()
    await expect(page.getByRole('dialog', { name: /select current level/i })).toBeVisible()
    await page.getByTestId('member-form-level-shs2').click()
    await page.getByRole('button', { name: /^save$/i }).last().click()
    await expect(page.getByTestId('member-form-level-toggle')).toContainText('SHS2')
    await page.getByTestId('combined-date-picker-date-of-birth-toggle').click()
    await expect(page.getByTestId('combined-date-picker-date-of-birth-dropdown')).toBeVisible()
    await expect(page.getByText('Select Date of Birth')).toBeVisible()
    await page.getByRole('button', { name: /close date of birth picker/i }).click()
    await expect(page.getByTestId('combined-date-picker-date-of-birth-dropdown')).toHaveCount(0)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    await page.getByTestId('add-member-modal').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Add New Member' })).toHaveCount(0)
  })

  test('developer mode notification tester stacks mobile toasts', async ({ page }) => {
    test.skip(isPreviewSmoke, 'Developer bypass is intentionally disabled in preview/prod smoke runs.')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loginWithDeveloperMode(page)
    await openDeveloperMode(page)

    await expect(page.getByRole('button', { name: /quick qa/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /deep qa/i })).toBeVisible()
    await page.getByRole('button', { name: /open preview/i }).click()
    await expect(page.getByRole('heading', { name: /notification qa preview/i })).toBeVisible()
    await page.getByRole('button', { name: /^all$/i }).click()
    await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /abaukua faustina/i })).toBeVisible()
  })

  test('developer mode launches create month and carry-over options switch cleanly', async ({ page }) => {
    test.skip(isPreviewSmoke, 'Developer bypass is intentionally disabled in preview/prod smoke runs.')

    await loginWithDeveloperMode(page)

    await page.evaluate(() => window.openCreateMonth?.())
    await expect(page.getByRole('heading', { name: 'Create New Month' })).toBeVisible()

    const copyEveryone = page.locator('input[name="copyMode"][value="all"]')
    const selectSpecific = page.locator('input[name="copyMode"][value="custom"]')
    const copyAttendance = page.locator('input[name="copyMode"][value="attendance"]')
    const startFresh = page.locator('input[name="copyMode"][value="empty"]')

    await page.getByText('Select specific people', { exact: true }).click()
    await expect(selectSpecific).toBeChecked()

    await page.getByText('Copy present people from a Sunday', { exact: true }).click()
    await expect(copyAttendance).toBeChecked()

    await page.getByText('Start fresh', { exact: true }).click()
    await expect(startFresh).toBeChecked()

    await page.getByText('Copy everyone', { exact: true }).click()
    await expect(copyEveryone).toBeChecked()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Create New Month' })).toHaveCount(0)
  })
})
