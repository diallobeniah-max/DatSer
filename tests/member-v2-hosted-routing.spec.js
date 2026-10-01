import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readLocalSupabase } from '../src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'

const local = readLocalSupabase()
if (!process.env.DATSER_LOCAL_SUPABASE_DB_CONTAINER?.startsWith('supabase_db_DatSer-MemberV2-Replay-')) {
  throw new Error('Hosted routing browser tests require a disposable replay database')
}
const admin = createClient(local.url, local.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
let fixture
const createdIds = []
test.beforeAll(async () => {
  const actors = {}
  for (const name of ['pilot', 'legacy']) {
    const email = `routing-${name}-${crypto.randomUUID()}@local.invalid`
    const password = `Local-${crypto.randomUUID()}-9a!`
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) throw created.error
    createdIds.push(created.data.user.id)
    const client = createClient(local.url, local.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedIn = await client.auth.signInWithPassword({ email, password })
    if (signedIn.error) throw signedIn.error
    actors[name] = { id: created.data.user.id, email, session: signedIn.data.session }
  }
  const rollout = await admin.from('member_v2_rollout_workspaces').upsert({ owner_id: actors.pilot.id, enabled: true })
  if (rollout.error) throw rollout.error
  const collaborator = await admin.from('collaborators').insert({ owner_id: actors.legacy.id,
    collaborator_user_id: actors.pilot.id, email: actors.pilot.email, status: 'accepted' })
  if (collaborator.error) throw collaborator.error
  fixture = { pilot: actors.pilot.id, legacy: actors.legacy.id,
    sessions: { pilot: actors.pilot.session, legacy: actors.legacy.session } }
})
test.afterAll(async () => {
  if (fixture) {
    const removed = await admin.from('collaborators').delete().eq('owner_id', fixture.legacy).eq('collaborator_user_id', fixture.pilot)
    if (removed.error) throw removed.error
  }
  for (const id of createdIds) {
    const removed = await admin.auth.admin.deleteUser(id)
    if (removed.error) throw removed.error
  }
})
const openHarness = async (page, overrides = {}) => {
  await page.addInitScript((value) => { window.__memberV2RoutingFixture = value }, { ...fixture, ...overrides })
  await page.goto('/tests/fixtures/member-v2-hosted-routing/index.html')
  await expect(page.getByTestId('route')).toBeVisible({ timeout: 10000 })
}

test('real authorized eligibility controls pilot, legacy, workspace and actor routing', async ({ page }) => {
  await openHarness(page)
  await expect(page.getByTestId('route')).toHaveText('V2')
  await page.getByRole('button', { name: 'Legacy workspace', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('legacy')
  await page.getByRole('button', { name: 'Pilot workspace', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('V2')
  await page.getByRole('button', { name: 'Switch actor', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('legacy')
  await page.getByRole('button', { name: 'New workspace scope', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('legacy')
})

test('late positive responses and failed eligibility cannot restore the previous scope', async ({ page }) => {
  let release
  let held = false
  const gate = new Promise((resolve) => { release = resolve })
  await page.route('**/rest/v1/rpc/member_v2_workspace_eligible', async (route) => {
    if (!held && route.request().postDataJSON().p_owner_id === fixture.pilot) {
      held = true
      const response = await route.fetch()
      expect(await response.json()).toBe(true)
      await gate
      await route.fulfill({ response })
    } else await route.continue()
  })
  await openHarness(page)
  await expect.poll(() => held).toBe(true)
  await expect(page.getByTestId('route')).toHaveText('legacy')
  await page.getByRole('button', { name: 'Legacy workspace', exact: true }).click()
  release()
  await expect(page.getByTestId('route')).toHaveText('legacy')
  await page.unroute('**/rest/v1/rpc/member_v2_workspace_eligible')
  await page.route('**/rest/v1/rpc/member_v2_workspace_eligible', (route) => route.abort('failed'))
  await page.getByRole('button', { name: 'Pilot workspace', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('legacy')
  for (const field of ['pendingChanges', 'failedChanges', 'conflicts']) {
    await page.getByRole('button', { name: field, exact: true }).click()
    await page.getByRole('button', { name: 'Check legacy writer', exact: true }).click()
    await expect(page.getByTestId('legacy-result')).toHaveText('blocked')
  }
  await page.getByRole('button', { name: 'Legacy workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Check legacy writer', exact: true }).click()
  await expect(page.getByTestId('legacy-result')).toHaveText('allowed')
})

test('offline start, confirmed scope, switching and reconnect use fresh eligibility', async ({ page }) => {
  await openHarness(page, { offlineStart: true })
  await expect(page.getByTestId('route')).toHaveText('legacy')
  await expect(page.getByTestId('calls')).toHaveText('0')
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('V2')
  await page.getByRole('button', { name: 'Go offline', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('V2')
  await page.getByRole('button', { name: 'Legacy workspace', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('legacy')
  await page.getByRole('button', { name: 'Pilot workspace', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('legacy')
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('V2')
  await page.getByRole('button', { name: 'Go offline', exact: true }).click()
  const disabled = await admin.from('member_v2_rollout_workspaces').update({ enabled: false }).eq('owner_id', fixture.pilot)
  if (disabled.error) throw disabled.error
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('legacy')
})
