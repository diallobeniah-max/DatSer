import { test, expect } from '@playwright/test'

const isPreviewSmoke = process.env.PLAYWRIGHT_USE_PREVIEW === '1'

// Fixed mobile shells intentionally reflow controls as the visual viewport changes.
// Dispatch through the element after the test has already asserted visibility to keep
// the smoke checks focused on the app behavior rather than Playwright's transient
// hit-target stability during that reflow.
const clickControl = (locator) => locator.evaluate((element) => {
  const control = element.closest('button, label, [role="button"]') || element
  control.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
  control.click()
})

const setControlledInput = (locator, value) => locator.evaluate((input, nextValue) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, nextValue)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}, value)

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
    test.setTimeout(90000)

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

    await setControlledInput(search, 'John')
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
    await setControlledInput(search, '')
    const compactDismiss = page.getByRole('button', { name: /dismiss compact ui suggestion/i })
    if (await compactDismiss.isVisible().catch(() => false)) {
      await clickControl(compactDismiss)
    }
    const toastCloseButtons = page.locator('.Toastify__close-button')
    for (let index = (await toastCloseButtons.count()) - 1; index >= 0; index -= 1) {
      const closeButton = toastCloseButtons.nth(index)
      if (await closeButton.isVisible().catch(() => false)) {
        await clickControl(closeButton)
      }
    }
    await page.waitForTimeout(250)

    // The current mobile viewport exercises the PWA shell. Other viewport sizes
    // are covered by fresh-page browser checks so a Chromium resize cannot lock a
    // fixed app shell while the test runner is collecting screenshots.
    const mobileLayout = await page.evaluate(() => {
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
    expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth)
    expect(mobileLayout.headerRect.top).toBeGreaterThanOrEqual(-1)
    expect(mobileLayout.contentHeight).toBeGreaterThan(0)
    expect(mobileLayout.dockRect.bottom).toBeLessThanOrEqual(mobileLayout.shellRect.bottom + 1)
    expect(mobileLayout.dockRect.bottom).toBeGreaterThan(mobileLayout.shellRect.bottom - 2)
    await page.screenshot({ path: testInfo.outputPath('pwa-shell-mobile.png'), fullPage: false })

    await page.evaluate(() => window.openSettings?.())
    await expect(page.getByRole('button', { name: /^Account\b/ })).toBeVisible()
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

  test('mobile keyboard mode compacts search results and keeps form actions visible', async ({ page }, testInfo) => {
    test.skip(isPreviewSmoke, 'Developer bypass is intentionally disabled in preview/prod smoke runs.')
    test.setTimeout(60000)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      localStorage.setItem('datser_compact_suggestion_dismissed_at', String(Date.now()))
      localStorage.setItem('datser_search_suggestion_prompt_seen_v1', 'true')
    })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loginWithDeveloperMode(page)

    const compactDismiss = page.getByRole('button', { name: /dismiss compact ui suggestion/i })
    if (await compactDismiss.isVisible().catch(() => false)) await compactDismiss.click()
    await page.locator('.Toastify__close-button').evaluateAll((buttons) => buttons.forEach((button) => button.click()))

    const firstCard = page.locator('.member-card').first()
    const normalCardHeight = await firstCard.evaluate((element) => element.getBoundingClientRect().height)
    const search = page.getByPlaceholder('Search members...')
    const searchDock = page.locator('.app-bottom-dock')
    const scanner = page.getByRole('button', { name: /scan member qr code/i })
    const addMember = page.getByTitle('Add New Member')
    const normalDockLayout = await page.evaluate(() => {
      const dock = document.querySelector('.app-bottom-dock')
      const input = document.querySelector('.member-search-dock-input')
      const scannerButton = document.querySelector('[aria-label="Scan member QR code"]')
      const addButton = Array.from(document.querySelectorAll('button')).find((button) => button.title === 'Add New Member')
      return {
        dockHeight: dock.getBoundingClientRect().height,
        inputHeight: input.getBoundingClientRect().height,
        scannerHeight: scannerButton.getBoundingClientRect().height,
        addHeight: addButton.getBoundingClientRect().height,
      }
    })
    expect(normalDockLayout.inputHeight).toBe(44)
    expect(normalDockLayout.scannerHeight).toBe(normalDockLayout.inputHeight)
    expect(normalDockLayout.addHeight).toBe(normalDockLayout.inputHeight)
    await search.focus()
    await expect(page.locator('.keyboard-search-active')).toBeVisible()
    await expect(searchDock).toBeVisible()
    await expect(scanner).toBeVisible()
    await expect(addMember).toBeVisible()
    const compactDockLayout = await page.evaluate(() => {
      const dock = document.querySelector('.app-bottom-dock')
      const input = document.querySelector('.member-search-dock-input')
      const scannerButton = document.querySelector('[aria-label="Scan member QR code"]')
      const addButton = Array.from(document.querySelectorAll('button')).find((button) => button.title === 'Add New Member')
      return {
        dockBottom: dock.getBoundingClientRect().bottom,
        inputHeight: input.getBoundingClientRect().height,
        scannerHeight: scannerButton.getBoundingClientRect().height,
        addHeight: addButton.getBoundingClientRect().height,
      }
    })
    expect(compactDockLayout.inputHeight).toBe(normalDockLayout.inputHeight)
    expect(compactDockLayout.scannerHeight).toBe(normalDockLayout.inputHeight)
    expect(compactDockLayout.addHeight).toBe(normalDockLayout.inputHeight)
    expect(compactDockLayout.dockBottom).toBeLessThanOrEqual(844)
    const compactCardHeight = await firstCard.evaluate((element) => element.getBoundingClientRect().height)
    const joinedDisplay = await firstCard.locator('.member-card-meta').evaluate((element) => getComputedStyle(element).display)
    expect(compactCardHeight).toBeLessThan(normalCardHeight)
    expect(compactCardHeight).toBeLessThan(110)
    expect(joinedDisplay).toBe('none')
    await page.locator('.Toastify__close-button').evaluateAll((buttons) => buttons.forEach((button) => button.click()))
    await page.screenshot({ path: testInfo.outputPath('keyboard-compact-search.png'), fullPage: false })

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 412, height: 915 },
    ]) {
      await page.setViewportSize(viewport)
      await page.waitForTimeout(50)
      expect(await firstCard.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(110)
      expect(await firstCard.locator('.member-card-meta').evaluate((element) => getComputedStyle(element).display)).toBe('none')
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await clickControl(firstCard.locator('.member-card-header'))
    await expect(search).not.toBeFocused()
    await expect(page.locator('.keyboard-search-active')).toHaveCount(0)
    await expect(firstCard.locator('.member-card-expanded')).toBeVisible()

    await search.focus()
    await clickControl(page.getByRole('button', { name: /scan member qr code/i }))
    await expect(search).not.toBeFocused()
    await expect(page.getByText('Scan member pass', { exact: true })).toBeVisible()
    await page.getByRole('dialog', { name: 'Scan member pass' }).getByRole('button', { name: 'Close scanner' }).evaluate((button) => button.click())
    await expect(page.getByRole('dialog', { name: 'Scan member pass' })).toHaveCount(0)

    await search.focus()
    await clickControl(page.getByTitle('Add New Member'))
    await expect(search).not.toBeFocused()
    await expect(page.getByTestId('add-member-modal')).toBeVisible()

    const addModal = page.getByTestId('add-member-modal')
    const addBody = addModal.locator('.keyboard-safe-modal-body')
    const addFooter = addModal.locator('.keyboard-safe-modal-footer')
    const nameInput = addModal.getByPlaceholder('Enter full name')
    await setControlledInput(nameInput, 'Keyboard QA Member')
    await nameInput.focus()
    await page.evaluate(() => {
      document.documentElement.classList.add('app-keyboard-open')
      document.documentElement.style.setProperty('--app-visual-height', '520px')
    })
    await page.waitForTimeout(100)

    const addLayout = await addModal.evaluate((shell) => {
      const footer = shell.querySelector('.keyboard-safe-modal-footer')
      const body = shell.querySelector('.keyboard-safe-modal-body')
      return {
        bodyOverflow: getComputedStyle(document.body).overflow,
        shellHeight: shell.getBoundingClientRect().height,
        shellBottom: shell.getBoundingClientRect().bottom,
        footerBottom: footer.getBoundingClientRect().bottom,
        bodyOverflowY: getComputedStyle(body).overflowY,
      }
    })
    expect(addLayout.bodyOverflow).toBe('hidden')
    expect(Math.abs(addLayout.shellHeight - 520)).toBeLessThan(1)
    expect(Math.abs(addLayout.footerBottom - addLayout.shellBottom)).toBeLessThan(1)
    expect(addLayout.bodyOverflowY).toBe('auto')

    await addBody.evaluate((element) => { element.scrollTop = element.scrollHeight })
    const attendanceButton = addModal.getByRole('button', { name: 'Present', exact: true }).last()
    await clickControl(attendanceButton)
    await expect(nameInput).not.toBeFocused()
    await nameInput.focus()
    await addBody.evaluate((element) => { element.scrollTop = element.scrollHeight })
    const parentName = addModal.getByTestId('member-form-parent1-name')
    await expect(parentName).toBeVisible()
    await parentName.focus()
    await page.waitForTimeout(100)
    const parentVisibility = await addBody.evaluate((body) => {
      const target = body.querySelector('[data-testid="member-form-parent1-name"]')
      const bodyRect = body.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      return targetRect.top >= bodyRect.top - 1 && targetRect.bottom <= bodyRect.bottom + 1
    })
    expect(parentVisibility).toBe(true)
    await expect(addFooter.getByRole('button', { name: /Add Member/i })).toBeVisible()
    await page.locator('.Toastify__close-button').evaluateAll((buttons) => buttons.forEach((button) => button.click()))
    await page.screenshot({ path: testInfo.outputPath('keyboard-safe-add-member.png'), fullPage: false })
    await clickControl(addFooter.getByRole('button', { name: 'Cancel', exact: true }))
    await expect(addModal).toHaveCount(0)

    await page.evaluate(() => {
      document.documentElement.classList.remove('app-keyboard-open')
      document.documentElement.style.removeProperty('--app-visual-height')
    })

    const editOpened = await page.evaluate(() => window.openDeveloperEditMember?.('John Doe'))
    expect(editOpened).toBe(true)
    const editModal = page.getByTestId('edit-member-modal')
    await expect(editModal).toBeVisible()
    const editName = editModal.getByPlaceholder('Enter full name')
    await editName.focus()
    await page.evaluate(() => {
      document.documentElement.classList.add('app-keyboard-open')
      document.documentElement.style.setProperty('--app-visual-height', '520px')
    })
    await editModal.locator('.keyboard-safe-modal-body').evaluate((element) => { element.scrollTop = element.scrollHeight })
    await clickControl(editModal.getByRole('button', { name: 'Present', exact: true }).last())
    await expect(editName).not.toBeFocused()
    const editLayout = await editModal.evaluate((shell) => ({
      shellBottom: shell.getBoundingClientRect().bottom,
      footerBottom: shell.querySelector('.keyboard-safe-modal-footer').getBoundingClientRect().bottom,
    }))
    expect(Math.abs(editLayout.footerBottom - editLayout.shellBottom)).toBeLessThan(1)
    await clickControl(editModal.getByRole('button', { name: 'Cancel', exact: true }))
    await expect(editModal).toHaveCount(0)

    let missingOpened = false
    for (const memberName of ['John Doe', 'Jane Smith', 'Michael Johnson']) {
      missingOpened = await page.evaluate((name) => window.openDeveloperMissingDataFlow?.(name, true), memberName)
      if (missingOpened) break
    }
    expect(missingOpened).toBe(true)
    const missingModal = page.getByTestId('missing-data-modal')
    await expect(missingModal).toBeVisible()
    await expect(missingModal.locator('.keyboard-safe-modal-body')).toBeVisible()
    await expect(missingModal.locator('.keyboard-safe-modal-footer')).toBeVisible()
    await page.waitForTimeout(350)
    const missingLayout = await missingModal.locator('.keyboard-safe-modal-shell').evaluate((shell) => ({
      shellBottom: shell.getBoundingClientRect().bottom,
      footerBottom: shell.querySelector('.keyboard-safe-modal-footer').getBoundingClientRect().bottom,
      bodyOverflowY: getComputedStyle(shell.querySelector('.keyboard-safe-modal-body')).overflowY,
    }))
    expect(Math.abs(missingLayout.footerBottom - missingLayout.shellBottom)).toBeLessThan(1)
    expect(missingLayout.bodyOverflowY).toBe('auto')
    await page.locator('.Toastify__close-button').evaluateAll((buttons) => buttons.forEach((button) => button.click()))
    await page.screenshot({ path: testInfo.outputPath('keyboard-safe-missing-info.png'), fullPage: false })

    await page.evaluate(() => {
      document.documentElement.classList.remove('app-keyboard-open')
      document.documentElement.style.removeProperty('--app-visual-height')
    })
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('developer mode launches add member and date picking stays stable', async ({ page }) => {
    test.skip(isPreviewSmoke, 'Developer bypass is intentionally disabled in preview/prod smoke runs.')

    await loginWithDeveloperMode(page)

    await page.evaluate(() => window.openAddMember?.())
    await expect(page.getByRole('heading', { name: 'Add New Member' })).toBeVisible()

    await setControlledInput(page.getByPlaceholder('Enter full name'), 'Smoke Member')
    await clickControl(page.getByText('Female'))
    await clickControl(page.getByTestId('member-form-level-toggle'))
    await expect(page.getByRole('dialog', { name: /select current level/i })).toBeVisible()
    await clickControl(page.getByTestId('member-form-level-shs2'))
    await clickControl(page.getByRole('button', { name: /^save$/i }).last())
    await expect(page.getByTestId('member-form-level-toggle')).toContainText('SHS2')
    await clickControl(page.getByTestId('combined-date-picker-date-of-birth-toggle'))
    await expect(page.getByTestId('combined-date-picker-date-of-birth-dropdown')).toBeVisible()
    await expect(page.getByText('Select Date of Birth')).toBeVisible()
    await clickControl(page.getByRole('button', { name: /close date of birth picker/i }))
    await expect(page.getByTestId('combined-date-picker-date-of-birth-dropdown')).toHaveCount(0)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    await clickControl(page.getByTestId('add-member-modal').getByRole('button', { name: 'Cancel' }))
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

    await clickControl(page.getByText('Select specific people', { exact: true }))
    await expect(selectSpecific).toBeChecked()

    await clickControl(page.getByText('Copy present people from a Sunday', { exact: true }))
    await expect(copyAttendance).toBeChecked()

    await clickControl(page.getByText('Start fresh', { exact: true }))
    await expect(startFresh).toBeChecked()

    await clickControl(page.getByText('Copy everyone', { exact: true }))
    await expect(copyEveryone).toBeChecked()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    await clickControl(page.getByRole('button', { name: 'Cancel' }))
    await expect(page.getByRole('heading', { name: 'Create New Month' })).toHaveCount(0)
  })
})
