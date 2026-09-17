import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { readLocalSupabase } from '../src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'
import { createMemberV2Fingerprint } from '../src/experiments/rxdb-member-phase1/memberContractFingerprint.js'

const local = readLocalSupabase()
const textExact = (value) => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')

const ensureCurrentAppColumns = (tableName) => {
  if (!/^[A-Z][a-z]+_\d{4}$/.test(tableName)) throw new Error('Synthetic test table name is invalid.')
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const container = execFileSync(docker, ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
  if (!container) throw new Error('Local Supabase database container is required for the real UI test.')
  execFileSync(docker, ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `alter table public."${tableName}"
    add column if not exists deleted_at timestamptz,
    add column if not exists date_of_birth text,
    add column if not exists "Manual Badge" text,
    add column if not exists "Badge Type" text,
    add column if not exists is_visitor boolean,
    add column if not exists parent_name_1 text,
    add column if not exists parent_phone_1 text,
    add column if not exists parent_name_2 text,
    add column if not exists parent_phone_2 text,
    add column if not exists notes text,
    add column if not exists ministry text,
    add column if not exists attendance_2026_01_04 boolean,
    add column if not exists attendance_2026_01_11 boolean,
    add column if not exists attendance_2026_01_18 boolean,
    add column if not exists attendance_2026_01_25 boolean,
    add column if not exists attendance_2026_09_06 boolean,
    add column if not exists attendance_2026_09_13 boolean,
    add column if not exists attendance_2026_09_20 boolean,
    add column if not exists attendance_2026_09_27 boolean;`], { stdio: 'ignore' })
}

const ensureLocalPreferenceColumns = () => {
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const container = execFileSync(docker, ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
  if (!container) throw new Error('Local Supabase database container is required for the real UI test.')
  execFileSync(docker, ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `alter table public.user_preferences
    add column if not exists workspace_member_codes_enabled boolean,
    add column if not exists member_code_quick_pass_enabled boolean,
    add column if not exists member_code_show_logo boolean,
    add column if not exists member_code_show_photo boolean,
    add column if not exists member_code_show_email boolean,
    add column if not exists member_code_auto_profile_enabled boolean,
    add column if not exists member_code_badge_style text,
    add column if not exists member_code_card_style text,
    add column if not exists member_code_church_name text,
    add column if not exists member_code_logo_url text,
    add column if not exists member_code_turbo_enabled boolean,
    add column if not exists member_code_turbo_notification_enabled boolean,
    add column if not exists member_code_auto_cycle_minutes integer,
    add column if not exists member_code_lookup_enabled boolean,
    add column if not exists member_code_share_message_template text,
    add column if not exists guided_form_settings jsonb,
    add column if not exists member_name_style text,
    add column if not exists member_code_format text,
    add column if not exists member_code_length integer;`], { stdio: 'ignore' })
}

const createFixture = async () => {
  ensureLocalPreferenceColumns()
  const admin = createClient(local.url, local.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `real-ui-member-v2-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@local.invalid`
  const password = `RealUi-${crypto.randomUUID()}-9a!`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const userId = created.data.user.id
  const client = createClient(local.url, local.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  const january = await client.rpc('create_workspace_month', { p_owner_id: userId, p_year: 2026, p_month: 1, p_source_month: null, p_copy_mode: 'empty', p_member_ids: [] })
  const september = await client.rpc('create_workspace_month', { p_owner_id: userId, p_year: 2026, p_month: 9, p_source_month: null, p_copy_mode: 'empty', p_member_ids: [] })
  if (january.error || september.error) throw january.error || september.error
  ensureCurrentAppColumns(january.data.table_name)
  ensureCurrentAppColumns(september.data.table_name)
  const suffix = crypto.randomUUID().slice(0, 8)
  const originalName = `Real UI offline original ${suffix}`
  const editedName = `Real UI offline edited ${suffix}`
  const member = { 'Full Name': originalName, 'Phone Number': '0240000000', Gender: 'Female', Age: '18', 'Current Level': 'SHS3' }
  const createMember = async (tableName, payload) => {
    const memberId = crypto.randomUUID()
    const requestId = crypto.randomUUID()
    const fingerprint = await createMemberV2Fingerprint({ operation: 'create_member_v2', ownerId: userId, tableName, memberId, payload })
    const saved = await client.rpc('create_member_v2', { p_table_name: tableName, p_owner_id: userId, p_member_id: memberId, p_member: payload, p_request_id: requestId, p_payload_fingerprint: fingerprint })
    if (saved.error || saved.data?.status !== 'SUCCESS') throw saved.error || new Error('Could not prepare the synthetic Member V2 record.')
    return { ...saved.data, memberId }
  }
  const januaryMember = await createMember(january.data.table_name, member)
  const septemberMember = await createMember(september.data.table_name, member)
  const visible = await client.from(september.data.table_name).select('id, "Full Name", workspace_owner_id').eq('id', septemberMember.memberId).eq('workspace_owner_id', userId).single()
  if (visible.error || visible.data?.['Full Name'] !== member['Full Name']) throw visible.error || new Error('Synthetic Member V2 record is not visible to its authenticated workspace.')
  return { admin, email, password, userId, originalName, editedName, memberCodes: new Map([[januaryMember.memberId, januaryMember.member.member_code], [septemberMember.memberId, septemberMember.member.member_code]]) }
}

const signInToRealDatser = async (page, fixture, diagnostics = null) => {
  await page.goto('/index.html')
  await page.getByPlaceholder('Email').fill(fixture.email)
  await page.getByPlaceholder('Password').fill(fixture.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForTimeout(750)
  if (diagnostics) {
    diagnostics.mainText = (await page.locator('main').innerText().catch(() => '')).slice(0, 2000)
    diagnostics.appState = await page.evaluate(() => window.__datserMemberV2LocalDiagnostic || null)
  }
  await expect(page.getByText(textExact(fixture.originalName)).first()).toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('member-v2-local-diagnostics')).toContainText('Sync state: SYNCED', { timeout: 30000 })
}

const dismissLocalUiPrompts = async (page) => {
  // First-login suggestions are intentional production UI. Dismiss them only
  // in this browser proof so they cannot cover the real connection selector.
  await page.getByRole('button', { name: 'Dismiss compact UI suggestion' }).click({ timeout: 1000 }).catch(() => {})
  await page.getByRole('button', { name: 'Keep full', exact: true }).click({ timeout: 1000 }).catch(() => {})
}

test('the real connection selector keeps a Member V2 profile edit local until reconnect', async ({ page, browser }, testInfo) => {
  const fixture = await createFixture()
  let secondContext = null
  const diagnostics = { responses: [], consoleErrors: [] }
  try {
    const updateRequests = []
    page.on('request', (request) => {
      if (!request.url().includes('/rest/v1/rpc/update_member_v2')) return
      updateRequests.push(JSON.parse(request.postData() || '{}'))
    })
    page.on('response', async (response) => {
      if (!response.url().includes('127.0.0.1:54321')) return
      const entry = { url: response.url().split('?')[0], status: response.status() }
      if (response.status() >= 400) entry.error = (await response.text()).slice(0, 500)
      if (response.status() === 200 && response.url().includes('/September_2026')) {
        const body = await response.json().catch(() => null)
        entry.resultCount = Array.isArray(body) ? body.length : null
      }
      diagnostics.responses.push(entry)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => diagnostics.pageErrors = [...(diagnostics.pageErrors || []), error.message])

    await signInToRealDatser(page, fixture, diagnostics)
    await dismissLocalUiPrompts(page)
    // The real app intentionally blocks header controls while a modal is open,
    // so choose Offline before opening the standard Edit Details modal.
    await page.getByTitle('Connection and offline mode').click()
    await page.getByRole('button', { name: 'Offline', exact: true }).click()
    await page.getByRole('button', { name: new RegExp(`^${fixture.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Joined Today`, 'i') }).first().click()
    await page.getByRole('button', { name: 'Edit Details', exact: true }).click()
    await expect(page.getByTestId('edit-member-modal')).toBeVisible()

    await page.getByTestId('edit-form-full-name').fill(fixture.editedName)
    await page.getByTestId('edit-form-phone').fill('0555000000')
    await page.getByTestId('edit-form-submit').click()
    await expect(page.getByText('Member saved locally and is waiting to sync.')).toBeVisible()
    expect(updateRequests).toHaveLength(0)

    await page.reload()
    await expect(page.getByText(textExact(fixture.editedName)).first()).toBeVisible({ timeout: 30000 })
    expect(updateRequests).toHaveLength(0)
    await dismissLocalUiPrompts(page)

    secondContext = await browser.newContext()
    const secondPage = await secondContext.newPage()
    await signInToRealDatser(secondPage, fixture)
    await dismissLocalUiPrompts(secondPage)
    await expect(secondPage.getByText(textExact(fixture.originalName)).first()).toBeVisible()
    await expect(secondPage.getByText(textExact(fixture.editedName))).toHaveCount(0)

    await dismissLocalUiPrompts(page)
    await page.getByTitle('Connection and offline mode').click()
    await page.getByRole('button', { name: 'Online', exact: true }).click()
    await expect.poll(() => updateRequests.length, { timeout: 30000 }).toBe(1)
    const updateRequest = updateRequests[0]
    expect(updateRequest.p_member_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(updateRequest.p_request_id).toMatch(/^update_member_v2:/)

    await expect.poll(async () => {
      const result = await fixture.admin.from(updateRequest.p_table_name).select('id, "Full Name", "Phone Number"').eq('id', updateRequest.p_member_id).single()
      return result.data
    }, { timeout: 30000 }).toMatchObject({ id: updateRequest.p_member_id, 'Full Name': fixture.editedName, 'Phone Number': 555000000 })
    const storedMutation = await fixture.admin.from('member_v2_mutations').select('request_id, member_id').eq('request_id', updateRequest.p_request_id)
    expect(storedMutation.error).toBeNull()
    expect(storedMutation.data).toEqual([{ request_id: updateRequest.p_request_id, member_id: updateRequest.p_member_id }])

    await secondPage.reload()
    await expect(secondPage.getByText(textExact(fixture.editedName)).first()).toBeVisible({ timeout: 30000 })
    const code = await fixture.admin.from('workspace_member_codes').select('current_code').eq('workspace_owner_id', fixture.userId).eq('member_id', updateRequest.p_member_id).single()
    expect(code.error).toBeNull()
    expect(code.data.current_code).toBe(fixture.memberCodes.get(updateRequest.p_member_id))
  } finally {
    await testInfo.attach('local-ui-network-summary', { body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json' })
    await secondContext?.close()
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})
