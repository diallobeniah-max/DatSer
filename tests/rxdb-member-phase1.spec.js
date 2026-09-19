import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readLocalSupabase } from '../src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'

test('isolated Member V2 route is available without mounting production member screens', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/rxdb-member-phase1.html')
  await expect(page.getByTestId('member-v2-poc-root')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'DatSer Member V2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open local workspace' })).toBeVisible()
  await expect(page.getByText('Isolated Phase 1 client harness')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('simulated offline keeps Client A local until reconnect, then Client B receives the confirmed member and attendance', async ({ page, browser }) => {
  const local = readLocalSupabase(); const admin = createClient(local.url, local.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `member-v2-browser-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@local.invalid`; const password = `MemberV2-${crypto.randomUUID()}-9a!`; let userId = null; let secondContext = null
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull(); userId = created.data.user.id
    const setupClient = createClient(local.url, local.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }); const login = await setupClient.auth.signInWithPassword({ email, password }); expect(login.error).toBeNull()
    const month = await setupClient.rpc('create_workspace_month', { p_owner_id: userId, p_year: 2025, p_month: 12, p_source_month: null, p_copy_mode: 'empty', p_member_ids: [] }); expect(month.error).toBeNull()
    const signIn = async (clientPage) => { await clientPage.goto('/rxdb-member-phase1.html'); await clientPage.getByLabel('Email').fill(email); await clientPage.getByLabel('Password').fill(password); await clientPage.getByLabel('Workspace owner UUID').fill(userId); await clientPage.getByRole('button', { name: 'Open local workspace' }).click(); await expect(clientPage.getByTestId('member-v2-network-state')).toHaveText('ONLINE') }
    await signIn(page)
    await page.getByLabel('Full Name').fill('Offline browser original'); await page.getByRole('button', { name: 'Save member locally' }).click()
    const firstCard = page.getByTestId('member-v2-row').filter({ hasText: 'Offline browser original' }); await expect(firstCard).toContainText('SERVER_CONFIRMED')
    await page.getByTestId('member-v2-network-toggle').click(); await expect(page.getByTestId('member-v2-network-state')).toHaveText('SIMULATED OFFLINE')
    await firstCard.getByRole('button', { name: 'Edit member' }).click(); await page.getByLabel('Full Name').last().fill('Offline browser local edit'); await page.getByRole('button', { name: 'Save profile locally' }).click()
    await page.getByTestId('member-v2-row').filter({ hasText: 'Offline browser local edit' }).getByRole('button', { name: 'Present' }).first().click()
    await expect(page.getByTestId('member-v2-sync-state')).toHaveText('OFFLINE / PENDING'); await expect(page.getByTestId('member-v2-attendance-sync-state')).toHaveText('OFFLINE / PENDING')
    await page.reload(); await expect(page.getByTestId('member-v2-network-state')).toHaveText('SIMULATED OFFLINE'); await expect(page.getByTestId('member-v2-row').filter({ hasText: 'Offline browser local edit' })).toBeVisible()
    secondContext = await browser.newContext(); const secondPage = await secondContext.newPage(); await signIn(secondPage); await expect(secondPage.getByText('Offline browser original')).toBeVisible(); await expect(secondPage.getByText('Offline browser local edit')).toHaveCount(0)
    await page.getByTestId('member-v2-network-toggle').click(); await expect(page.getByTestId('member-v2-pending-members')).toHaveText('0'); await expect(page.getByTestId('member-v2-pending-attendance')).toHaveText('0'); await expect(page.getByTestId('member-v2-row').filter({ hasText: 'Offline browser local edit' })).toContainText('SERVER_CONFIRMED')
    await secondPage.reload(); await expect(secondPage.getByText('Offline browser local edit')).toBeVisible(); await expect(secondPage.locator('.attendance-value').filter({ hasText: 'Present' })).toBeVisible()
  } finally {
    await secondContext?.close(); if (userId) await admin.auth.admin.deleteUser(userId)
  }
})
