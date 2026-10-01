import { test, expect } from '@playwright/test'
import { createSyntheticFixture } from '../src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'

let fixture
const signIn = async (page, user, workspaceId) => {
  await page.goto('/rxdb-poc.html')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByLabel('Workspace ID').fill(workspaceId)
  await page.getByRole('button', { name: 'Sign in locally' }).click()
  await expect(page.getByText('RxDB is the UI authority')).toBeVisible()
}

test.beforeAll(async () => { fixture = await createSyntheticFixture() })
test.afterAll(async () => { for (const user of [fixture.ownerA, fixture.collaboratorA, fixture.userB]) await fixture.admin.auth.admin.deleteUser(user.id) })

test('real auth, acknowledgement timing, persistence, reconnect and second-client sync', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  await signIn(owner, fixture.ownerA, fixture.workspaceA)

  let releasePush
  const holdPush = new Promise((resolve) => { releasePush = resolve })
  await owner.route('**/rest/v1/rpc/poc_create_member', async (route) => { const response = await route.fetch(); await holdPush; await route.fulfill({ response }) })
  await owner.getByPlaceholder('Add a synthetic member').fill('Browser Synthetic Member')
  await owner.getByRole('button', { name: 'Save locally' }).click()
  await expect(owner.getByText('LOCAL_PENDING')).toBeVisible()
  releasePush()
  await expect(owner.getByText('SERVER_CONFIRMED')).toBeVisible({ timeout: 15000 })
  const member = owner.locator('article').filter({ hasText: 'Browser Synthetic Member' })
  const memberId = await member.getAttribute('data-member-id')

  await owner.reload()
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('Browser Synthetic Member')

  const collaboratorContext = await browser.newContext()
  const collaborator = await collaboratorContext.newPage()
  await signIn(collaborator, fixture.collaboratorA, fixture.workspaceA)
  await expect(collaborator.locator(`[data-member-id="${memberId}"]`)).toContainText('Browser Synthetic Member')

  await owner.locator(`[data-member-id="${memberId}"]`).getByRole('button', { name: 'Present' }).click()
  await expect(owner.getByText('1 active attendance record(s)')).toBeVisible({ timeout: 15000 })
  await expect.poll(async () => {
    const result = await fixture.ownerA.client.from('poc_attendance').select('id').eq('member_id', memberId)
    return result.data?.length || 0
  }, { timeout: 15000 }).toBe(1)
  await expect.poll(async () => Number(await collaborator.getByTestId('attendance-signal-count').textContent()), { timeout: 15000 }).toBeGreaterThan(0)
  await expect(collaborator.getByText('1 active attendance record(s)')).toBeVisible({ timeout: 15000 })
  await expect(collaborator.getByTestId(`attendance-${memberId}`)).toContainText('present · SERVER_CONFIRMED')

  await owner.locator(`[data-member-id="${memberId}"]`).getByRole('button', { name: 'Absent' }).click()
  await expect(collaborator.getByTestId(`attendance-${memberId}`)).toContainText('absent · SERVER_CONFIRMED', { timeout: 15000 })
  await owner.locator(`[data-member-id="${memberId}"]`).getByRole('button', { name: 'Clear' }).click()
  await expect(collaborator.getByText('0 active attendance record(s)')).toBeVisible({ timeout: 15000 })

  await owner.route('**/rest/v1/rpc/poc_update_member', (route) => route.abort('internetdisconnected'))
  owner.once('dialog', (dialog) => dialog.accept('Durable Offline Edit'))
  await owner.locator(`[data-member-id="${memberId}"]`).getByRole('button', { name: 'Edit' }).click()
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('FAILED_RETRYABLE', { timeout: 10000 })
  await owner.reload()
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('Durable Offline Edit')
  await owner.unroute('**/rest/v1/rpc/poc_update_member')
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('SERVER_CONFIRMED', { timeout: 20000 })
  await expect(collaborator.locator(`[data-member-id="${memberId}"]`)).toContainText('Durable Offline Edit', { timeout: 20000 })

  const count = await fixture.ownerA.client.from('poc_members').select('id', { count: 'exact', head: true }).eq('id', memberId)
  expect(count.count).toBe(1)
  await collaboratorContext.close(); await ownerContext.close()
})

test('a newer remote revision preserves the offline local edit as a recoverable conflict', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const collaboratorContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const collaborator = await collaboratorContext.newPage()
  await signIn(owner, fixture.ownerA, fixture.workspaceA)
  await signIn(collaborator, fixture.collaboratorA, fixture.workspaceA)

  await owner.getByPlaceholder('Add a synthetic member').fill('Conflict Baseline')
  await owner.getByRole('button', { name: 'Save locally' }).click()
  const baseline = owner.locator('article').filter({ hasText: 'Conflict Baseline' })
  await expect(baseline).toContainText('SERVER_CONFIRMED', { timeout: 15000 })
  const memberId = await baseline.getAttribute('data-member-id')
  await expect(collaborator.locator(`[data-member-id="${memberId}"]`)).toContainText('Conflict Baseline', { timeout: 15000 })

  await owner.route('**/rest/v1/**', (route) => route.abort('internetdisconnected'))
  owner.once('dialog', (dialog) => dialog.accept('Offline Local Revision'))
  await owner.locator(`[data-member-id="${memberId}"]`).getByRole('button', { name: 'Edit' }).click()
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('FAILED_RETRYABLE', { timeout: 10000 })

  collaborator.once('dialog', (dialog) => dialog.accept('Remote Authoritative Revision'))
  await collaborator.locator(`[data-member-id="${memberId}"]`).getByRole('button', { name: 'Edit' }).click()
  await expect(collaborator.locator(`[data-member-id="${memberId}"]`)).toContainText('SERVER_CONFIRMED', { timeout: 15000 })

  await owner.reload()
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('Offline Local Revision')
  await owner.unroute('**/rest/v1/**')
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('CONFLICT', { timeout: 20000 })
  await expect(owner.locator(`[data-member-id="${memberId}"]`)).toContainText('Offline Local Revision')
  const remote = await fixture.ownerA.client.from('poc_members').select('full_name, revision').eq('id', memberId).single()
  expect(remote.data).toEqual({ full_name: 'Remote Authoritative Revision', revision: 2 })

  await collaboratorContext.close(); await ownerContext.close()
})

test('cross-workspace user cannot open Workspace A', async ({ page }) => {
  await page.goto('/rxdb-poc.html')
  await page.getByLabel('Email').fill(fixture.userB.email)
  await page.getByLabel('Password').fill(fixture.userB.password)
  await page.getByLabel('Workspace ID').fill(fixture.workspaceA)
  await page.getByRole('button', { name: 'Sign in locally' }).click()
  await expect(page.getByText('Workspace access denied.')).toBeVisible()
})
