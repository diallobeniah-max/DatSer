import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { readLocalSupabase, readLocalSupabaseDbContainer } from '../src/experiments/rxdb-backend-poc/testing/localSupabaseFixture.js'
import { createMemberV2Fingerprint } from '../src/experiments/rxdb-member-phase1/memberContractFingerprint.js'

const local = readLocalSupabase()
const textExact = (value) => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
const textContains = (value) => new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

const ensureCurrentAppColumns = (tableName) => {
  if (!/^[A-Z][a-z]+_\d{4}$/.test(tableName)) throw new Error('Synthetic test table name is invalid.')
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const container = readLocalSupabaseDbContainer()
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
    add column if not exists attendance_2026_01_04 text,
    add column if not exists attendance_2026_01_11 text,
    add column if not exists attendance_2026_01_18 text,
    add column if not exists attendance_2026_01_25 text,
    add column if not exists attendance_2026_09_06 text,
    add column if not exists attendance_2026_09_13 text,
    add column if not exists attendance_2026_09_20 text,
    add column if not exists attendance_2026_09_27 text;`], { stdio: 'ignore' })
}

const ensureLocalPreferenceColumns = () => {
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const container = readLocalSupabaseDbContainer()
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

const readLocalRealtimeWalSnapshot = (ownerId) => {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error('Synthetic owner UUID is invalid.')
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const container = readLocalSupabaseDbContainer()
  if (!container) throw new Error('Local Supabase database container is required for the Realtime diagnostic.')
  const query = `select json_build_object(
    'capturedAt', clock_timestamp(),
    'currentWalLsn', pg_current_wal_lsn()::text,
    'publication', (select json_build_object(
      'name', p.pubname,
      'publishInsert', p.pubinsert,
      'signalTablePresent', exists(select 1 from pg_publication_tables t where t.pubname = p.pubname and t.schemaname = 'public' and t.tablename = 'member_v2_realtime_signals')
    ) from pg_publication p where p.pubname = 'supabase_realtime'),
    'replicaIdentity', (select c.relreplident::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'member_v2_realtime_signals'),
    'realtimeSlots', coalesce((select json_agg(json_build_object(
      'name', slot_name,
      'plugin', plugin,
      'database', database,
      'active', active,
      'restartLsn', restart_lsn::text,
      'confirmedFlushLsn', confirmed_flush_lsn::text
    ) order by slot_name) from pg_replication_slots), '[]'::json),
    'replicationConnections', coalesce((select json_agg(json_build_object(
      'applicationName', application_name,
      'state', state,
      'sentLsn', sent_lsn::text,
      'writeLsn', write_lsn::text,
      'flushLsn', flush_lsn::text,
      'replayLsn', replay_lsn::text,
      'backendStartedAt', backend_start
    ) order by application_name) from pg_stat_replication), '[]'::json),
    'signalTableSubscriptionCount', (select count(*) from realtime.subscription where entity = to_regclass('public.member_v2_realtime_signals')),
    'registeredSubscriptions', coalesce((select json_agg(json_build_object(
      'subscriptionId', subscription_id::text,
      'entity', entity::text,
      'event', action_filter,
      'filters', filters::text,
      'role', claims_role::text
    ) order by subscription_id) from realtime.subscription
      where entity = to_regclass('public.member_v2_realtime_signals')
        and (claims->>'sub' = '${ownerId}' or filters::text like '%${ownerId}%')), '[]'::json)
  )::text;`
  const output = execFileSync(docker, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-c', query,
  ], { encoding: 'utf8' }).trim()
  return JSON.parse(output)
}

const createFixture = async ({ phoneNumber = '0240000000' } = {}) => {
  ensureLocalPreferenceColumns()
  const admin = createClient(local.url, local.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `real-ui-member-v2-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@local.invalid`
  const password = `RealUi-${crypto.randomUUID()}-9a!`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const userId = created.data.user.id
  const rollout = await admin.from('member_v2_rollout_workspaces').upsert({ owner_id: userId, enabled: true })
  if (rollout.error) throw rollout.error
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
  const member = { 'Full Name': originalName, 'Phone Number': phoneNumber, Gender: 'Female', Age: '18', 'Current Level': 'SHS3' }
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
  return {
    admin,
    client,
    email,
    password,
    userId,
    originalName,
    editedName,
    januaryMemberId: januaryMember.memberId,
    septemberMemberId: septemberMember.memberId,
    memberCodes: new Map([[januaryMember.memberId, januaryMember.member.member_code], [septemberMember.memberId, septemberMember.member.member_code]]),
  }
}

const signInToRealDatser = async (page, fixture, diagnostics = null, { waitForMemberCard = true } = {}) => {
  await page.goto('/index.html')
  await page.getByPlaceholder('Email').fill(fixture.email)
  await page.getByPlaceholder('Password').fill(fixture.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  if (diagnostics) {
    diagnostics.mainText = (await page.locator('main').innerText().catch(() => '')).slice(0, 2000)
    diagnostics.appState = await page.evaluate(() => window.__datserMemberV2LocalDiagnostic || null)
  }
  if (waitForMemberCard) {
    await expect(getVisibleMemberCard(page, fixture, fixture.originalName).first()).toBeVisible({ timeout: 30000 })
  }
  // The normal shared-web route intentionally has no experiment diagnostics panel.
}

const dismissLocalUiPrompts = async (page, evidence = null) => {
  // Dismiss first-login suggestions through their normal button. A suggestion
  // toast can sit above the compact-UI card and intercept its dismiss button.
  const keepFull = page.getByRole('button', { name: 'Keep full', exact: true })
  if (await keepFull.isVisible().catch(() => false)) {
    if (evidence) evidence.searchDisplayPromptDetected = true
    await keepFull.click({ timeout: 2000 })
    await expect(keepFull).toBeHidden({ timeout: 5000 })
    if (evidence) evidence.searchDisplayPromptDismissed = true
  }
  const toastDismiss = page.getByRole('button', { name: 'Dismiss notification' }).first()
  if (await toastDismiss.isVisible().catch(() => false)) {
    if (evidence) evidence.notificationToastDetected = true
    const toast = toastDismiss.locator('xpath=ancestor::*[@role="alert"][1]')
    await toastDismiss.click({ timeout: 2000 })
    await expect(toast).toBeHidden({ timeout: 5000 })
    if (evidence) evidence.notificationToastDismissed = true
  }
  const dismiss = page.getByRole('button', { name: 'Dismiss compact UI suggestion' })
  if (await dismiss.isVisible().catch(() => false)) {
    if (evidence) evidence.compactUiPromptDetected = true
    await dismiss.click({ timeout: 2000 })
    await expect(dismiss).toBeHidden({ timeout: 5000 })
    if (evidence) evidence.compactUiPromptDismissed = true
  }
  const tutorialTitle = page.getByText('Want a quick tutorial?', { exact: true })
  if (await tutorialTitle.isVisible().catch(() => false)) {
    const tutorialPrompt = tutorialTitle.locator('xpath=ancestor::div[contains(@class, "fixed")][1]')
    await tutorialPrompt.getByTitle('Dismiss').click({ timeout: 2000 })
    await expect(tutorialTitle).toBeHidden({ timeout: 5000 })
    if (evidence) evidence.tutorialPromptDismissed = true
  }
}

const clickConnectionControl = async (page, evidence = null) => {
  const control = page.getByTitle('Connection and offline mode')
  const dismiss = page.getByRole('button', { name: 'Dismiss compact UI suggestion' })
  const keepFull = page.getByRole('button', { name: 'Keep full', exact: true })
  const dismissStatus = page.getByRole('button', { name: 'Dismiss status' })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissLocalUiPrompts(page, evidence)
    if (await dismissStatus.isVisible().catch(() => false)) await dismissStatus.click({ timeout: 2000 }).catch(() => {})
    try {
      await control.click({ trial: true, timeout: 2000 })
      if (evidence) evidence.connectionControlInteractable = true
      await control.click({ timeout: 2000 })
      return
    } catch (error) {
      const compactVisible = await dismiss.isVisible().catch(() => false)
      const fullVisible = await keepFull.isVisible().catch(() => false)
      if (!compactVisible && !fullVisible) throw error
    }
  }
  throw new Error('Connection control remained covered after supported local UI prompts were dismissed.')
}

const installMemberIdTrace = (page, fixture) => page.addInitScript(({ memberId, expectedProfileValue }) => {
  window.__datserMemberV2IdTrace = { enabled: true, memberIds: [memberId], expectedProfileValue, events: [] }
}, { memberId: fixture.septemberMemberId, expectedProfileValue: fixture.editedName })

const getMemberAttendanceSelector = (memberId) => `[data-testid="member-card-attendance-${memberId}"], [data-testid^="member-card-attendance-${memberId}-"]`

const getVisibleMemberCard = (page, fixture, profileValue) => page.locator('.member-card:visible')
  .filter({ has: page.locator(getMemberAttendanceSelector(fixture.septemberMemberId)) })
  .filter({ hasText: textContains(profileValue) })

const captureMemberIdState = async (page, fixture) => {
  const snapshot = await page.evaluate(async ({ memberId, expectedProfileValue }) => {
  const diagnostic = window.__datserMemberV2LocalDiagnostic
  if (!diagnostic?.readSnapshot) return { at: new Date().toISOString(), id: memberId, diagnosticReady: false }
  const snapshot = await diagnostic.readSnapshot([memberId])
  const find = (rows) => (rows || []).find((row) => String(row.id) === memberId) || null
  const rxdbMember = find(snapshot.rxdb?.members)
  const appContextMember = find(snapshot.appContextRows)
  const dashboard = window.__datserMemberV2DashboardDiagnostic
  const dashboardMember = find(dashboard?.derivedRows)
  const dashboardVisibleMember = find(dashboard?.visibleRows)
  const targetAttendanceNode = [...document.querySelectorAll('[data-testid^="member-card-attendance-"]')]
    .find((node) => String(node.getAttribute('data-testid') || '').startsWith(`member-card-attendance-${memberId}`))
  const card = targetAttendanceNode?.closest('.member-card') || null
  const idSelector = `[data-testid="member-card-attendance-${memberId}"], [data-testid^="member-card-attendance-${memberId}-"]`
  const targetCards = [...document.querySelectorAll('.member-card')].filter((candidate) => candidate.querySelector(idSelector))
  const visibleCards = targetCards.filter((candidate) => {
    const style = window.getComputedStyle(candidate)
    const rect = candidate.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  })
  const normalizedExpected = String(expectedProfileValue || '').toLocaleLowerCase()
  return {
    at: new Date().toISOString(),
    id: memberId,
    tableName: snapshot.currentTable,
    rxdb: {
      present: Boolean(rxdbMember),
      revision: rxdbMember?.serverRevision ?? null,
      deleted: rxdbMember?.deleted ?? null,
      valueMatches: rxdbMember?.profileValueMatches ?? null,
      displayNameMatches: rxdbMember?.memberCardDisplayNameMatches ?? null,
      saveState: rxdbMember?.saveState ?? null,
      pendingCount: (snapshot.rxdb?.mutations || []).filter((mutation) => mutation.memberId === memberId).length,
    },
    appContext: {
      present: Boolean(appContextMember),
      referenceId: appContextMember?.referenceId ?? null,
      revision: appContextMember?.serverRevision ?? null,
      deleted: appContextMember?.deleted ?? null,
      valueMatches: appContextMember?.profileValueMatches ?? null,
      fullNameAliasMatches: appContextMember?.fullNameAliasMatches ?? null,
      displayNameMatches: appContextMember?.memberCardDisplayNameMatches ?? null,
    },
    dashboard: {
      present: Boolean(dashboardMember),
      referenceId: dashboardMember?.referenceId ?? null,
      revision: dashboardMember?.serverRevision ?? null,
      deleted: dashboardMember?.deleted ?? null,
      valueMatches: dashboardMember?.profileValueMatches ?? null,
      fullNameAliasMatches: dashboardMember?.fullNameAliasMatches ?? null,
      displayNameMatches: dashboardMember?.memberCardDisplayNameMatches ?? null,
      visibleListPresent: Boolean(dashboardVisibleMember),
      visibleListValueMatches: dashboardVisibleMember?.profileValueMatches ?? null,
      visibleListDisplayNameMatches: dashboardVisibleMember?.memberCardDisplayNameMatches ?? null,
    },
    rendered: {
      present: visibleCards.length > 0,
      valueMatches: false,
      targetCardCount: targetCards.length,
      visibleTargetCardCount: visibleCards.length,
      textContentMatches: visibleCards.some((candidate) => String(candidate.textContent || '').toLocaleLowerCase().includes(normalizedExpected)),
      headingTextMatches: visibleCards.some((candidate) => String(candidate.querySelector('.member-card-name')?.textContent || '').toLocaleLowerCase().includes(normalizedExpected)),
      visibleValueMatchCount: 0,
    },
    memberCardRenderEvents: (window.__datserMemberV2IdTrace?.events || [])
      .filter((event) => event.stage === 'member-card-render' && event.id === memberId)
      .slice(-8)
      .map(({ at, id, referenceId, serverRevision, saveState, profileNameMatches }) => ({ at, id, referenceId, serverRevision, saveState, profileNameMatches })),
    memberCardMemoEvents: (window.__datserMemberV2IdTrace?.events || [])
      .filter((event) => event.stage === 'member-card-memo-comparison' && event.id === memberId)
      .slice(-8)
      .map(({ at, id, previousMemberReferenceId, nextMemberReferenceId, memberReferenceChanged, previousRevision, nextRevision, previousProfileValueMatches, nextProfileValueMatches, comparatorEqual }) => ({
        at,
        id,
        previousMemberReferenceId,
        nextMemberReferenceId,
        memberReferenceChanged,
        previousRevision,
        nextRevision,
        previousProfileValueMatches,
        nextProfileValueMatches,
        comparatorEqual,
      })),
  }
  }, { memberId: fixture.septemberMemberId, expectedProfileValue: fixture.editedName })
  if (snapshot.rendered) {
    const targetCards = page.locator('.member-card').filter({
      has: page.locator(getMemberAttendanceSelector(fixture.septemberMemberId)),
    })
    const visibleTargetCards = page.locator('.member-card:visible').filter({
      has: page.locator(getMemberAttendanceSelector(fixture.septemberMemberId)),
    })
    const visibleValueMatches = getVisibleMemberCard(page, fixture, fixture.editedName)
    snapshot.rendered.targetCardCount = await targetCards.count()
    snapshot.rendered.visibleTargetCardCount = await visibleTargetCards.count()
    snapshot.rendered.visibleValueMatchCount = await visibleValueMatches.count()
    snapshot.rendered.valueMatches = snapshot.rendered.visibleValueMatchCount > 0
  }
  return snapshot
}

const watchMemberPulls = (page, fixture, events, client) => {
  page.on('websocket', (socket) => {
    events.push({ at: new Date().toISOString(), client, stage: 'realtime-websocket-open' })
    socket.on('framereceived', () => events.push({ at: new Date().toISOString(), client, stage: 'realtime-frame-received' }))
  })
  page.on('request', (request) => {
    if (!request.url().includes('/rest/v1/rpc/pull_workspace_member_changes_v2')) return
    const body = request.postDataJSON() || {}
    events.push({ at: new Date().toISOString(), client, stage: 'pull-request', ownerId: body.p_owner_id || null, cursor: body.p_after_server_revision ?? null, tableName: 'September_2026', memberId: fixture.septemberMemberId })
  })
  page.on('response', async (response) => {
    if (!response.url().includes('/rest/v1/rpc/pull_workspace_member_changes_v2')) return
    const payload = await response.json().catch(() => null)
    const change = payload?.changes?.find((row) => String(row.member_id) === fixture.septemberMemberId) || null
    events.push({
      at: new Date().toISOString(),
      client,
      stage: 'pull-response',
      httpStatus: response.status(),
      memberId: fixture.septemberMemberId,
      tableName: change?.table_name || null,
      present: Boolean(change),
      revision: change?.server_revision ?? null,
      isDeleted: change ? Boolean(change.is_deleted) : null,
      valueMatches: change?.member?.['Full Name'] === fixture.editedName,
      nextCursor: payload?.next_cursor ?? null,
    })
  })
}

test('the real connection selector keeps a Member V2 profile edit local until reconnect', async ({ page, browser }, testInfo) => {
  const fixture = await createFixture()
  let secondContext = null
  const diagnostics = { responses: [], consoleErrors: [], clientASnapshots: [], clientBSnapshots: [], clientBPulls: [], uiPrompt: {} }
  try {
    await installMemberIdTrace(page, fixture)
    watchMemberPulls(page, fixture, diagnostics.clientBPulls, 'A')
    const updateRequests = []
    page.on('request', (request) => {
      if (!request.url().includes('/rest/v1/rpc/update_member_v2')) return
      updateRequests.push(JSON.parse(request.postData() || '{}'))
    })
    page.on('response', async (response) => {
      if (response.url().includes('/rest/v1/rpc/update_member_v2')) {
        const payload = await response.json().catch(() => null)
        diagnostics.clientAUpdateConfirmation = {
          at: new Date().toISOString(),
          httpStatus: response.status(),
          memberId: payload?.member?.id || payload?.member_id || fixture.septemberMemberId,
          tableName: payload?.table_name || 'September_2026',
          revision: payload?.server_revision ?? null,
          status: payload?.status || null,
          valueMatches: payload?.member?.['Full Name'] === fixture.editedName,
        }
      }
      if (!response.url().startsWith(`${local.url}/rest/v1/`)) return
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
    await clickConnectionControl(page, diagnostics.uiPrompt)
    // The real app intentionally blocks header controls while a modal is open,
    // so choose Offline before opening the standard Edit Details modal.
    await page.getByRole('button', { name: 'Offline', exact: true }).click()
    await getVisibleMemberCard(page, fixture, fixture.originalName).getByRole('button').first().click()
    await page.getByRole('button', { name: 'Edit Details', exact: true }).click()
    await expect(page.getByTestId('edit-member-modal')).toBeVisible()

    await page.getByTestId('edit-form-full-name').fill(fixture.editedName)
    await page.getByTestId('edit-form-phone').fill('0555000000')
    await page.getByTestId('edit-form-submit').click()
    await expect(page.getByText('Member changes saved locally and are waiting to sync.')).toBeVisible()
    expect(updateRequests).toHaveLength(0)
    diagnostics.clientASnapshots.push({ stage: 'offline-edit-before-reload', ...(await captureMemberIdState(page, fixture)) })
    expect(diagnostics.clientASnapshots.at(-1)).toMatchObject({
      tableName: 'September_2026',
      rxdb: { present: true, valueMatches: true, pendingCount: 1 },
    })

    await page.reload()
    try {
      await expect.poll(async () => {
        const snapshot = await captureMemberIdState(page, fixture)
        diagnostics.clientASnapshots.push({ stage: 'offline-reload-convergence-sample', ...snapshot })
        return snapshot.rendered?.valueMatches || false
      }, { timeout: 30000, intervals: [100, 250, 500, 1000] }).toBe(true)
    } catch (error) {
      diagnostics.clientASnapshots.push({ stage: 'offline-reload-immediate-timeout-sample', ...(await captureMemberIdState(page, fixture)) })
      throw error
    }
    expect(updateRequests).toHaveLength(0)
    diagnostics.clientASnapshots.push({ stage: 'offline-reload', ...(await captureMemberIdState(page, fixture)) })
    expect(diagnostics.clientASnapshots.at(-1)).toMatchObject({
      tableName: 'September_2026',
      rxdb: { present: true, valueMatches: true, pendingCount: 1 },
      appContext: { present: true, valueMatches: true },
      dashboard: { present: true, valueMatches: true },
      rendered: { present: true, valueMatches: true },
    })
    await dismissLocalUiPrompts(page, diagnostics.uiPrompt)

    secondContext = await browser.newContext()
    const secondPage = await secondContext.newPage()
    await installMemberIdTrace(secondPage, fixture)
    watchMemberPulls(secondPage, fixture, diagnostics.clientBPulls, 'B')
    await signInToRealDatser(secondPage, fixture)
    await dismissLocalUiPrompts(secondPage, diagnostics.uiPrompt)
    await expect(getVisibleMemberCard(secondPage, fixture, fixture.originalName).first()).toBeVisible()
    await expect(getVisibleMemberCard(secondPage, fixture, fixture.editedName)).toHaveCount(0)
    diagnostics.clientBSnapshots.push({ stage: 'before-reconnect', ...(await captureMemberIdState(secondPage, fixture)) })

    await clickConnectionControl(page, diagnostics.uiPrompt)
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
    const serverMember = await fixture.admin.from(updateRequest.p_table_name).select('id, "Full Name"').eq('id', updateRequest.p_member_id).single()
    const serverEvent = await fixture.admin.from('member_v2_change_events')
      .select('server_revision, table_name, operation_name')
      .eq('owner_id', fixture.userId).eq('member_id', updateRequest.p_member_id)
      .order('server_revision', { ascending: false }).limit(1).maybeSingle()
    diagnostics.clientAServer = {
      at: new Date().toISOString(),
      memberId: updateRequest.p_member_id,
      tableName: updateRequest.p_table_name,
      revision: serverEvent.data?.server_revision ?? null,
      operation: serverEvent.data?.operation_name ?? null,
      valueMatches: serverMember.data?.['Full Name'] === fixture.editedName,
      mutationConfirmed: storedMutation.data.length === 1,
    }
    expect(serverMember.error).toBeNull()
    expect(serverEvent.error).toBeNull()
    expect(diagnostics.clientAServer).toMatchObject({
      memberId: fixture.septemberMemberId,
      tableName: 'September_2026',
      operation: 'update_member_v2',
      valueMatches: true,
      mutationConfirmed: true,
    })
    expect(diagnostics.clientAUpdateConfirmation).toMatchObject({
      httpStatus: 200,
      memberId: fixture.septemberMemberId,
      tableName: 'September_2026',
      status: 'SUCCESS',
      valueMatches: true,
    })

    await secondPage.reload()
    try {
      await expect.poll(async () => {
        const snapshot = await captureMemberIdState(secondPage, fixture)
        diagnostics.clientBSnapshots.push(snapshot)
        return snapshot.rendered?.valueMatches || false
      }, { timeout: 30000, intervals: [100, 250, 500, 1000] }).toBe(true)
    } catch (error) {
      diagnostics.clientBSnapshots.push({ stage: 'immediate-timeout-sample', ...(await captureMemberIdState(secondPage, fixture)) })
      throw error
    }
    const code = await fixture.admin.from('workspace_member_codes').select('current_code').eq('workspace_owner_id', fixture.userId).eq('member_id', updateRequest.p_member_id).single()
    expect(code.error).toBeNull()
    expect(code.data.current_code).toBe(fixture.memberCodes.get(updateRequest.p_member_id))
  } finally {
    await testInfo.attach('local-ui-network-summary', { body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json' })
    await secondContext?.close()
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})

test('normal UI offline attendance survives reload and syncs once on reconnect', async ({ page }, testInfo) => {
  const fixture = await createFixture()
  const calls = []
  const rpcResponses = []
  const sunday = '2026-09-27'
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/save_member_v2_attendance')) calls.push(request.postDataJSON() || {})
  })
  page.on('response', async (response) => {
    if (!response.url().includes('/rest/v1/rpc/save_member_v2_attendance')) return
    const body = await response.json().catch(() => null)
    const message = String(body?.message || body?.error_message || '').toLowerCase()
    rpcResponses.push({
      httpStatus: response.status(),
      resultStatus: body?.status || null,
      errorCode: body?.code || null,
      errorCategory: !message ? null : /rollout|not enabled/.test(message) ? 'rollout-disabled'
        : /attendance|sunday|month|workspace|member/.test(message) ? 'attendance-contract'
          : 'other',
    })
  })
  await installMemberIdTrace(page, fixture)
  try {
    await signInToRealDatser(page, fixture)
    await dismissLocalUiPrompts(page)
    await clickConnectionControl(page)
    await page.getByRole('button', { name: 'Offline', exact: true }).click()
    await getVisibleMemberCard(page, fixture, fixture.originalName).first().click()
    const prefix = 'member-card-attendance-' + fixture.septemberMemberId + '-' + sunday
    await page.getByTestId(prefix + '-present').click()
    await expect(page.getByTestId(prefix + '-present')).toHaveAttribute('aria-pressed', 'true')
    const pending = await page.evaluate(async (memberId) => window.__datserMemberV2LocalDiagnostic.readSnapshot([memberId]), fixture.septemberMemberId)
    expect(pending.attendance?.records).toMatchObject([{ memberId: fixture.septemberMemberId, tableName: 'September_2026', attendanceDate: sunday, status: 'Present', saveState: 'LOCAL_PENDING' }])
    expect(pending.attendance?.mutations).toMatchObject([{ memberId: fixture.septemberMemberId, operation: 'set_member_v2_attendance', saveState: 'LOCAL_PENDING' }])
    expect(calls).toHaveLength(0)
    await page.reload()
    await getVisibleMemberCard(page, fixture, fixture.originalName).first().click()
    await expect(page.getByTestId(prefix + '-present')).toHaveAttribute('aria-pressed', 'true')
    expect((await page.evaluate(async (id) => window.__datserMemberV2LocalDiagnostic.readSnapshot([id]), fixture.septemberMemberId)).attendance?.mutations).toHaveLength(1)
    expect(calls).toHaveLength(0)
    await page.getByRole('button', { name: 'Dismiss status' }).click().catch(() => {})
    await clickConnectionControl(page)
    await page.getByRole('button', { name: 'Online', exact: true }).click()
    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(1)
    // The isolated fixture adds this legacy-shaped column as text; the trusted
    // Member V2 RPC must persist the canonical status value without coercion.
    await expect.poll(async () => fixture.admin.from('September_2026').select('"attendance_2026_09_27"').eq('id', fixture.septemberMemberId).eq('workspace_owner_id', fixture.userId).single().then((result) => result.data?.attendance_2026_09_27), { timeout: 30000 }).toBe('Present')
    await expect.poll(async () => page.evaluate(async (id) => window.__datserMemberV2LocalDiagnostic.readSnapshot([id]), fixture.septemberMemberId).then((snapshot) => snapshot.attendance?.mutations?.length), { timeout: 30000 }).toBe(0)
    const allAttendance = await fixture.admin.from('September_2026').select('"attendance_2026_09_27"').eq('id', fixture.septemberMemberId).eq('workspace_owner_id', fixture.userId).single()
    expect(allAttendance.data?.attendance_2026_09_27).toBe('Present')
    await page.reload()
    await getVisibleMemberCard(page, fixture, fixture.originalName).first().click()
    await expect(page.getByTestId(prefix + '-present')).toHaveAttribute('aria-pressed', 'true')
    expect(calls).toHaveLength(1)
  } finally {
    await testInfo.attach('offline-attendance-counts.json', { body: Buffer.from(JSON.stringify(calls.map((call) => ({ memberId: call.p_member_id, date: call.p_attendance_date, tableName: call.p_table_name })), null, 2)), contentType: 'application/json' })
    const serverRead = await fixture.admin.from('September_2026').select('"attendance_2026_09_27"').eq('id', fixture.septemberMemberId).eq('workspace_owner_id', fixture.userId).maybeSingle()
    const localAttendance = await page.evaluate(async (id) => {
      const snapshot = await window.__datserMemberV2LocalDiagnostic.readSnapshot([id])
      const record = snapshot.attendance?.records?.[0]
      const mutation = snapshot.attendance?.mutations?.[0]
      const error = String(mutation?.lastError || '').toLowerCase()
      return {
        record: record ? { status: record.status, saveState: record.saveState, serverRevisionPresent: record.serverRevision != null } : null,
        mutation: mutation ? {
          operation: mutation.operation,
          saveState: mutation.saveState,
          retryCount: mutation.retryCount,
          errorCategory: !error ? null : /rollout|not enabled/.test(error) ? 'rollout-disabled'
            : /attendance|sunday|month|workspace|member/.test(error) ? 'attendance-contract'
              : 'other',
        } : null,
      }
    }, fixture.septemberMemberId).catch(() => null)
    await testInfo.attach('offline-attendance-diagnostic.json', {
      body: Buffer.from(JSON.stringify({ rpcResponses, serverValue: serverRead.data?.attendance_2026_09_27 ?? null, serverReadError: serverRead.error?.code || null, localAttendance }, null, 2)),
      contentType: 'application/json',
    })
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})

test('normal UI offline delete survives reload and soft-deletes once on reconnect', async ({ page }, testInfo) => {
  const fixture = await createFixture()
  const calls = []
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/delete_member_v2')) calls.push(request.postDataJSON() || {})
  })
  await installMemberIdTrace(page, fixture)
  try {
    await signInToRealDatser(page, fixture)
    await dismissLocalUiPrompts(page)
    await clickConnectionControl(page)
    await expect(page.getByRole('button', { name: 'Offline', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Offline', exact: true }).click()
    await getVisibleMemberCard(page, fixture, fixture.originalName).first().getByRole('button').first().click()
    await page.getByRole('button', { name: 'Delete Member', exact: true }).first().click()
    await page.getByRole('button', { name: 'Delete Member', exact: true }).last().click()
    await expect(getVisibleMemberCard(page, fixture, fixture.originalName)).toHaveCount(0)
    const pending = await page.evaluate(async (id) => window.__datserMemberV2LocalDiagnostic.readSnapshot([id]), fixture.septemberMemberId)
    expect(pending.rxdb?.mutations).toMatchObject([{ memberId: fixture.septemberMemberId, operation: 'delete_member_v2', saveState: 'LOCAL_PENDING' }])
    expect(calls).toHaveLength(0)
    await page.reload()
    await expect(getVisibleMemberCard(page, fixture, fixture.originalName)).toHaveCount(0)
    expect((await page.evaluate(async (id) => window.__datserMemberV2LocalDiagnostic.readSnapshot([id]), fixture.septemberMemberId)).rxdb?.mutations).toMatchObject([{ memberId: fixture.septemberMemberId, operation: 'delete_member_v2', saveState: 'LOCAL_PENDING' }])
    expect(calls).toHaveLength(0)
    const headBeforeReconnect = await fixture.admin.from('member_v2_heads')
      .select('server_revision').eq('owner_id', fixture.userId)
      .eq('table_name', 'September_2026').eq('member_id', fixture.septemberMemberId).single()
    expect(headBeforeReconnect.error).toBeNull()
    await clickConnectionControl(page)
    await expect(page.getByRole('button', { name: 'Online', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Online', exact: true }).click()
    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(1)
    await expect.poll(async () => fixture.admin.from('September_2026').select('deleted_at').eq('id', fixture.septemberMemberId).single().then((result) => Boolean(result.data?.deleted_at)), { timeout: 30000 }).toBe(true)
    await expect.poll(async () => page.evaluate(async (id) => window.__datserMemberV2LocalDiagnostic.readSnapshot([id]), fixture.septemberMemberId).then((snapshot) => snapshot.rxdb?.mutations?.length), { timeout: 30000 }).toBe(0)
    const deleteEvents = await fixture.admin.from('member_v2_change_events')
      .select('server_revision, operation_name, is_deleted, request_id')
      .eq('owner_id', fixture.userId).eq('table_name', 'September_2026').eq('member_id', fixture.septemberMemberId)
      .gt('server_revision', headBeforeReconnect.data.server_revision).order('server_revision', { ascending: true })
    expect(deleteEvents.error).toBeNull()
    expect(deleteEvents.data).toHaveLength(1)
    expect(deleteEvents.data[0]).toMatchObject({ operation_name: 'delete_member_v2', is_deleted: true, request_id: calls[0].p_request_id })
    const head = await fixture.admin.from('member_v2_heads').select('is_deleted').eq('owner_id', fixture.userId).eq('table_name', 'September_2026').eq('member_id', fixture.septemberMemberId).single()
    expect(head.data).toEqual({ is_deleted: true })
    const historical = await fixture.admin.from('January_2026').select('id').eq('id', fixture.januaryMemberId).single()
    expect(historical.data?.id).toBe(fixture.januaryMemberId)
    await page.reload()
    await expect(getVisibleMemberCard(page, fixture, fixture.originalName)).toHaveCount(0)
    expect(calls).toHaveLength(1)
  } finally {
    await testInfo.attach('offline-delete-counts.json', { body: Buffer.from(JSON.stringify(calls.map((call) => ({ memberId: call.p_member_id, tableName: call.p_table_name })), null, 2)), contentType: 'application/json' })
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})

test('normal UI Member V2 delete converges to a second client', async ({ page, browser }, testInfo) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const fixture = await createFixture()
  const clientB = await browser.newPage()
  const mutationCalls = []
  const pullEvents = []
  let clientBDeleteSnapshot = null
  let directDeletePull = null
  let serverDeleteState = null
  let serverDeleteEvents = []
  let deleteStartedAt = null
  let deleteRealtimeMetrics = null
  for (const [sourcePage, client] of [[page, 'A'], [clientB, 'B']]) {
    sourcePage.on('request', (request) => {
      const match = request.url().match(/\/rest\/v1\/rpc\/([^/?]+)/)
      if (match?.[1] === 'delete_member_v2') mutationCalls.push(client)
    })
    watchMemberPulls(sourcePage, fixture, pullEvents, client)
  }
  try {
    await installMemberIdTrace(clientB, fixture)
    await signInToRealDatser(page, fixture)
    await dismissLocalUiPrompts(page)
    await signInToRealDatser(clientB, fixture)
    await dismissLocalUiPrompts(clientB)
    const memberId = fixture.septemberMemberId
    await expect(getVisibleMemberCard(clientB, fixture, fixture.originalName).first()).toBeVisible()
    const startingHead = await fixture.admin.from('member_v2_heads').select('server_revision').eq('owner_id', fixture.userId)
      .eq('table_name', 'September_2026').eq('member_id', memberId).single()
    if (startingHead.error) throw startingHead.error

    await getVisibleMemberCard(page, fixture, fixture.originalName).first().getByRole('button').first().click()
    await page.getByRole('button', { name: 'Delete Member', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'Confirm Deletion' })).toBeVisible()
    deleteStartedAt = Date.now()
    await page.getByRole('button', { name: 'Delete Member', exact: true }).last().click()

    await expect.poll(() => mutationCalls).toEqual(['A'])
    await expect.poll(async () => {
      const row = await fixture.admin.from('September_2026').select('deleted_at').eq('id', memberId).single()
      return Boolean(row.data?.deleted_at)
    }).toBe(true)
    const [deletedRow, deletedHead, pullResult] = await Promise.all([
      fixture.admin.from('September_2026').select('deleted_at').eq('id', memberId).single(),
      fixture.admin.from('member_v2_heads').select('server_revision, is_deleted').eq('owner_id', fixture.userId)
        .eq('table_name', 'September_2026').eq('member_id', memberId).single(),
      fixture.client.rpc('pull_workspace_member_changes_v2', {
        p_owner_id: fixture.userId,
        p_after_server_revision: startingHead.data.server_revision,
        p_limit: 100,
      }),
    ])
    if (deletedRow.error || deletedHead.error || pullResult.error) throw deletedRow.error || deletedHead.error || pullResult.error
    serverDeleteState = { deletedAtPresent: Boolean(deletedRow.data.deleted_at), revision: deletedHead.data.server_revision, isDeleted: deletedHead.data.is_deleted }
    const pullChange = (pullResult.data?.changes || []).find((change) => String(change.member_id) === memberId) || null
    directDeletePull = {
      targetPresent: Boolean(pullChange),
      revision: pullChange?.server_revision ?? null,
      isDeleted: pullChange ? Boolean(pullChange.is_deleted) : null,
      nextCursor: pullResult.data?.next_cursor ?? null,
    }
    const changeEvents = await fixture.admin.from('member_v2_change_events')
      .select('server_revision, operation_name, is_deleted, request_id')
      .eq('owner_id', fixture.userId).eq('table_name', 'September_2026').eq('member_id', memberId)
      .gt('server_revision', startingHead.data.server_revision).order('server_revision', { ascending: true })
    if (changeEvents.error) throw changeEvents.error
    serverDeleteEvents = changeEvents.data || []
    await expect.poll(async () => {
      clientBDeleteSnapshot = await captureMemberIdState(clientB, fixture)
      return clientBDeleteSnapshot.rendered?.present === false
    }, { timeout: 30000, intervals: [100, 250, 500, 1000] }).toBe(true)
    const realtimeEvents = await clientB.evaluate(() => (window.__datserMemberV2IdTrace?.events || [])
      .filter((event) => event.stage === 'member-v2-realtime-signal-received')
      .map((event) => ({ at: event.at, revision: event.latestServerRevision ?? null })))
    const deletePullRequests = pullEvents.filter((event) => event.client === 'B' && event.stage === 'pull-request'
      && new Date(event.at).getTime() >= deleteStartedAt)
    const expectedDeleteRevision = serverDeleteEvents.at(-1)?.server_revision ?? null
    deleteRealtimeMetrics = {
      serverChangeEvents: serverDeleteEvents.length,
      matchingRealtimeCallbacks: realtimeEvents.filter((event) => Number(event.revision) === Number(expectedDeleteRevision)).length,
      followUpPulls: deletePullRequests.length,
    }
    expect(serverDeleteEvents).toHaveLength(1)
    expect(serverDeleteEvents[0]).toMatchObject({ operation_name: 'delete_member_v2', is_deleted: true })
    expect(deleteRealtimeMetrics).toMatchObject({ serverChangeEvents: 1, matchingRealtimeCallbacks: 1, followUpPulls: 1 })
    const historical = await fixture.admin.from('January_2026').select('id').eq('id', fixture.januaryMemberId).single()
    expect(historical.error).toBeNull()
    expect(historical.data.id).toBe(fixture.januaryMemberId)
    expect(pullEvents.some((event) => event.client === 'B')).toBe(true)
    await testInfo.attach('second-client-delete-id-only.json', {
      body: Buffer.from(JSON.stringify({
        memberId,
        ownerId: fixture.userId,
        deleteMutationOwners: mutationCalls,
        clientBPullStages: pullEvents.filter((event) => event.client === 'B').map((event) => event.stage),
        clientBIdBoundary: clientBDeleteSnapshot,
        serverDeleteEvents,
        deleteRealtimeMetrics,
        softDeleted: true,
        historicalMemberPreserved: true,
        clientBRenderedAfterDelete: false,
      }, null, 2)),
      contentType: 'application/json',
    })
  } finally {
    console.log('SECOND_CLIENT_DELETE_BOUNDARY_ID_ONLY', JSON.stringify({
      memberId: fixture.septemberMemberId,
      ownerId: fixture.userId,
      mutationCalls,
      serverDeleteState,
      directDeletePull,
      serverDeleteEvents,
      deleteRealtimeMetrics,
      clientBPullEvents: pullEvents.filter((event) => event.client === 'B' && event.stage.startsWith('pull-')),
      realtimeEvents: await clientB.evaluate(() => (window.__datserMemberV2IdTrace?.events || [])
        .filter((event) => event.stage === 'member-v2-realtime-signal-received')
        .map((event) => ({ stage: event.stage, revision: event.latestServerRevision ?? null }))).catch(() => []),
      clientBDeleteSnapshot,
    }))
    if (clientBDeleteSnapshot) await testInfo.attach('second-client-delete-boundary-id-only.json', {
      body: Buffer.from(JSON.stringify(clientBDeleteSnapshot, null, 2)),
      contentType: 'application/json',
    })
    await clientB.close().catch(() => {})
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})

test('normal member screens create, edit twice, mark attendance, and soft-delete through Member V2', async ({ page }, testInfo) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(10000)
  const fixture = await createFixture()
  const rpcRequests = []
  const createResponses = []
  const createEvidence = { tableName: 'September_2026', pending: null, confirmed: null, afterReload: null }
  await page.addInitScript(() => {
    window.__datserMemberV2IdTrace = { enabled: true, memberIds: [], events: [] }
  })
  page.on('request', request => {
    const match = request.url().match(/\/rest\/v1\/rpc\/([^/?]+)/)
    if (match) rpcRequests.push({ name: match[1], body: JSON.parse(request.postData() || '{}') })
  })
  page.on('response', response => {
    if (!response.url().includes('/rest/v1/rpc/create_member_v2')) return
    void response.json().then((payload) => createResponses.push({
      httpStatus: response.status(),
      status: payload?.status || null,
      memberId: payload?.member_id || payload?.member?.id || null,
      tableName: payload?.table_name || null,
      serverRevision: payload?.server_revision ?? null,
    })).catch(() => {})
  })
  await page.route('**/rest/v1/rpc/create_member_v2', async (route) => {
    const request = route.request().postDataJSON()
    createEvidence.memberId = String(request?.p_member_id || '')
    createEvidence.tableName = String(request?.p_table_name || '')
    createEvidence.pending = await page.evaluate(async (memberId) => {
      const diagnostic = window.__datserMemberV2LocalDiagnostic
      if (!diagnostic?.readSnapshot) return null
      const snapshot = await diagnostic.readSnapshot([memberId])
      const local = snapshot.rxdb?.members?.find((row) => row.id === memberId) || null
      return {
        rxdbSaveState: local?.saveState || null,
        rxdbServerRevision: local?.serverRevision ?? null,
        pendingMutationCount: snapshot.rxdb?.mutations?.filter((row) => row.memberId === memberId).length ?? null,
        appContextPresent: snapshot.appContextRows?.some((row) => row.id === memberId) || false,
      }
    }, createEvidence.memberId)
    await route.continue()
  })
  const suffix = crypto.randomUUID().slice(0, 8)
  const names = [`Normal UI V2 ${suffix}`, `Normal UI V2 first ${suffix}`, `Normal UI V2 second ${suffix}`]
  const openCard = async (name) => {
    if (!(await page.getByRole('button', { name: 'Edit Details', exact: true }).isVisible().catch(() => false))) {
      await page.getByRole('button', { name: new RegExp(`^${name} Joined Today`, 'i') }).first().click()
    }
  }
  try {
    await signInToRealDatser(page, fixture)
    await page.getByRole('button', { name: 'Dismiss compact UI suggestion' }).click({ force: true, timeout: 10000 }).catch(() => {})
    await dismissLocalUiPrompts(page)

    await page.getByRole('button', { name: 'Add Member', exact: true }).click()
    await expect(page.getByTestId('add-member-modal')).toBeVisible()
    await page.getByTestId('member-form-full-name').fill(names[0])
    await page.getByTestId('add-member-modal').getByText('Female', { exact: true }).click()
    await page.getByTestId('member-form-phone').fill('0240000000')
    await page.getByTestId('member-form-age').fill('18')
    await page.getByTestId('member-form-level-toggle').click()
    await page.getByTestId('member-form-level-custom-input').fill('SHS3')
    await page.getByTestId('member-form-level-custom-add').click()
    await page.getByTestId('member-form-parent1-name').fill('Synthetic Guardian')
    await page.getByTestId('member-form-submit').click()

    await expect(page.getByText(textExact(names[0])).first()).toBeVisible({ timeout: 30000 })
    await expect.poll(() => rpcRequests.filter(request => request.name === 'create_member_v2').length).toBe(1)
    const created = rpcRequests.find(request => request.name === 'create_member_v2')
    expect(created.body.p_table_name).toBe('September_2026')
    expect(created.body.p_owner_id).toBe(fixture.userId)
    const memberId = created.body.p_member_id
    await expect.poll(() => createResponses.length).toBe(1)
    const createResponse = createResponses[0]
    expect(createResponse).toMatchObject({ httpStatus: 200, status: 'SUCCESS', memberId, tableName: 'September_2026' })
    await expect.poll(async () => {
      const result = await fixture.admin.from('September_2026').select('id, "Full Name"').eq('id', memberId).single()
      return result.data?.['Full Name']
    }).toBe(names[0])
    const createEvent = await fixture.admin.from('member_v2_change_events')
      .select('server_revision, table_name, operation_name, is_deleted')
      .eq('owner_id', fixture.userId).eq('member_id', memberId).eq('operation_name', 'create_member_v2').single()
    expect(createEvent.error).toBeNull()
    createEvidence.serverRevision = createEvent.data.server_revision
    createEvidence.serverEvent = {
      tableName: createEvent.data.table_name,
      operation: createEvent.data.operation_name,
      deleted: Boolean(createEvent.data.is_deleted),
    }
    createEvidence.confirmed = await page.evaluate(async (id) => {
      const diagnostic = window.__datserMemberV2LocalDiagnostic
      if (!diagnostic?.readSnapshot) return null
      const snapshot = await diagnostic.readSnapshot([id])
      const local = snapshot.rxdb?.members?.find((row) => row.id === id) || null
      return {
        rxdbSaveState: local?.saveState || null,
        rxdbServerRevision: local?.serverRevision ?? null,
        pendingMutationCount: snapshot.rxdb?.mutations?.filter((row) => row.memberId === id).length ?? null,
        appContextPresent: snapshot.appContextRows?.some((row) => row.id === id) || false,
      }
    }, memberId)
    await page.reload()
    await expect(page.getByText(textExact(names[0])).first()).toBeVisible({ timeout: 30000 })
    createEvidence.afterReload = await page.evaluate(async (id) => {
      const diagnostic = window.__datserMemberV2LocalDiagnostic
      if (!diagnostic?.readSnapshot) return null
      const snapshot = await diagnostic.readSnapshot([id])
      const local = snapshot.rxdb?.members?.find((row) => row.id === id) || null
      const rendered = [...document.querySelectorAll('[data-testid^="member-card-attendance-"]')]
        .some((node) => String(node.getAttribute('data-testid') || '').includes(id))
      return {
        tableName: snapshot.currentTable,
        rxdbSaveState: local?.saveState || null,
        rxdbServerRevision: local?.serverRevision ?? null,
        pendingMutationCount: snapshot.rxdb?.mutations?.filter((row) => row.memberId === id).length ?? null,
        appContextPresent: snapshot.appContextRows?.some((row) => row.id === id) || false,
        previewPresent: snapshot.previewIndexRows?.some((row) => row.id === id) || false,
        rendered,
      }
    }, memberId)
    expect(createEvidence.afterReload).toMatchObject({ tableName: 'September_2026', rxdbSaveState: 'SERVER_CONFIRMED', appContextPresent: true, rendered: true })

    for (let index = 1; index <= 2; index += 1) {
      await openCard(names[index - 1])
      await page.getByRole('button', { name: 'Edit Details', exact: true }).click()
      await page.getByTestId('edit-form-full-name').fill(names[index])
      await page.getByTestId('edit-form-submit').click()
      await expect(page.getByText(textExact(names[index])).first()).toBeVisible({ timeout: 30000 })
      await expect.poll(async () => {
        const result = await fixture.admin.from('September_2026').select('"Full Name"').eq('id', memberId).single()
        return result.data?.['Full Name']
      }).toBe(names[index])
      await page.reload()
      await expect(page.getByText(textExact(names[index])).first()).toBeVisible({ timeout: 30000 })
    }
    expect(rpcRequests.filter(request => request.name === 'update_member_v2')).toHaveLength(2)

    await openCard(names[2])
    const sunday = '2026-09-06'
    const attendanceHead = async () => {
      const result = await fixture.admin.from('member_v2_change_events')
        .select('table_name, attendance_status, is_deleted, server_revision')
        .eq('owner_id', fixture.userId).eq('member_id', memberId).eq('attendance_date', sunday)
        .order('server_revision', { ascending: false }).limit(1).maybeSingle()
      if (result.error) throw result.error
      return result.data
    }
    const monthlyAttendanceValue = async () => {
      const result = await fixture.admin.from('September_2026').select('"attendance_2026_09_06"')
        .eq('id', memberId).eq('workspace_owner_id', fixture.userId).single()
      if (result.error) throw result.error
      return result.data?.attendance_2026_09_06 ?? null
    }
    await page.getByTestId(`member-card-attendance-${memberId}-${sunday}-present`).click()
    await expect.poll(() => rpcRequests.filter(request => request.name === 'save_member_v2_attendance').length).toBe(1)
    await expect.poll(attendanceHead).toMatchObject({ table_name: 'September_2026', attendance_status: 'Present', is_deleted: false })
    await expect.poll(monthlyAttendanceValue).toBe('Present')
    await page.reload()
    await expect(page.getByText(textExact(names[2])).first()).toBeVisible({ timeout: 30000 })
    await openCard(names[2])
    await expect(page.getByTestId(`member-card-attendance-${memberId}-${sunday}-present`)).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId(`member-card-attendance-${memberId}-${sunday}-absent`).click()
    await expect.poll(() => rpcRequests.filter(request => request.name === 'save_member_v2_attendance').length).toBe(2)
    await expect.poll(attendanceHead).toMatchObject({ table_name: 'September_2026', attendance_status: 'Absent', is_deleted: false })
    await expect.poll(monthlyAttendanceValue).toBe('Absent')
    await page.reload()
    await expect(page.getByText(textExact(names[2])).first()).toBeVisible({ timeout: 30000 })
    await openCard(names[2])
    await expect(page.getByTestId(`member-card-attendance-${memberId}-${sunday}-absent`)).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId(`member-card-attendance-${memberId}-${sunday}-clear`).click()
    await expect.poll(() => rpcRequests.filter(request => request.name === 'save_member_v2_attendance').length).toBe(3)
    expect(rpcRequests.filter(request => request.name === 'save_member_v2_attendance').map(request => request.body.p_attendance_status)).toEqual(['Present', 'Absent', null])
    await expect.poll(attendanceHead).toMatchObject({ table_name: 'September_2026', attendance_status: null, is_deleted: true })
    await expect.poll(monthlyAttendanceValue).toBeNull()
    await page.reload()
    await expect(page.getByText(textExact(names[2])).first()).toBeVisible({ timeout: 30000 })
    await openCard(names[2])
    await expect(page.getByTestId(`member-card-attendance-${memberId}-${sunday}-present`)).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId(`member-card-attendance-${memberId}-${sunday}-absent`)).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(attendanceHead).toMatchObject({ table_name: 'September_2026', attendance_status: null, is_deleted: true })
    const otherSunday = await fixture.admin.from('member_v2_change_events').select('member_id')
      .eq('owner_id', fixture.userId).eq('member_id', memberId).eq('attendance_date', '2026-09-13')
    expect(otherSunday.data).toEqual([])

    await page.getByRole('button', { name: 'Delete Member', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'Confirm Deletion' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete Member', exact: true }).last().click()
    await expect.poll(() => rpcRequests.filter(request => request.name === 'delete_member_v2').length).toBe(1)
    await expect.poll(async () => {
      const result = await fixture.admin.from('September_2026').select('deleted_at').eq('id', memberId).single()
      return Boolean(result.data?.deleted_at)
    }).toBe(true)
    const januaryHistory = await fixture.admin.from('January_2026').select('id').eq('workspace_owner_id', fixture.userId)
    expect(januaryHistory.data).toHaveLength(1)
    expect(await attendanceHead()).toMatchObject({ attendance_status: null, is_deleted: true })
    await page.reload()
    await expect(page.getByText(textExact(names[2]))).toHaveCount(0)
    expect(rpcRequests.filter(request => ['add_member', 'update_member', 'delete_member', 'mark_attendance'].includes(request.name))).toHaveLength(0)
  } finally {
    if (createEvidence.memberId) {
      console.log('NORMAL_UI_MEMBER_V2_ID_ONLY', JSON.stringify({ ...createEvidence, response: createResponses[0] || null }))
      await testInfo.attach('fresh-create-confirm-reload-id-only.json', {
        body: Buffer.from(JSON.stringify({ ...createEvidence, response: createResponses[0] || null }, null, 2)),
        contentType: 'application/json',
      })
    }
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})

test('real edit modal keeps its dirty baseline during a second-client authoritative refresh', async ({ page, browser }, testInfo) => {
  const fixture = await createFixture({ phoneNumber: '5555555555' })
  const clientB = await browser.newPage()
  const mutationCalls = []
  const pullEvents = []
  const realtimeSignalEvents = []
  const independentSignalEvents = []
  const independentSignalStatuses = []
  let independentSignalChannel = null
  const evidence = {
    id: fixture.septemberMemberId,
    tableName: 'September_2026',
    openingRevision: null,
    remoteRevision: null,
    serverSignalRevision: null,
    authenticatedSignalVisible: false,
    authenticatedSignalHttpStatus: null,
    authenticatedSignalOwnerMatches: false,
    authenticatedSignalRevisionMatches: false,
    authenticatedSignalId: null,
    authenticatedSignalCreatedAt: null,
    authenticatedSignalErrorCode: null,
    clientBObservedRemoteRevision: false,
    modalStayedOpen: false,
    baselineNameStayedStable: false,
    localPhoneStayedStable: false,
    submittedFieldKeys: [],
    finalRevision: null,
    finalFullNameMatchesRemote: false,
    finalPhoneMatchesLocalEdit: false,
    finalAgeMatchesLocalEdit: false,
    observedMutationOwners: [],
  }
  const captureMutation = (client) => client.on('request', (request) => {
    const match = request.url().match(/\/rest\/v1\/rpc\/([^/?]+)/)
    if (!match || !['update_member_v2', 'update_member_bundle_resilient'].includes(match[1])) return
    const body = request.postDataJSON() || {}
    const updates = body.p_updates || body.p_member_updates || body.updates || {}
    mutationCalls.push({ client, operation: match[1], fieldKeys: Object.keys(updates).sort(), body })
  })
  captureMutation(page)
  captureMutation(clientB)
  watchMemberPulls(page, fixture, pullEvents, 'A')
  watchMemberPulls(clientB, fixture, pullEvents, 'B')
  for (const [sourcePage, client] of [[page, 'A'], [clientB, 'B']]) {
    sourcePage.on('websocket', (socket) => socket.on('framereceived', (frame) => {
      try {
        const frameText = typeof frame === 'string'
          ? frame
          : Buffer.isBuffer(frame)
            ? frame.toString('utf8')
            : frame instanceof ArrayBuffer
              ? Buffer.from(frame).toString('utf8')
              : ArrayBuffer.isView(frame)
                ? Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('utf8')
                : null
        if (!frameText) return
        const decoded = JSON.parse(frameText)
        const data = decoded?.payload?.data || decoded?.payload || {}
        if (data?.table !== 'member_v2_realtime_signals') return
        const record = data.record || {}
        realtimeSignalEvents.push({
          client,
          type: data.type || null,
          table: data.table,
          latestServerRevision: record.latest_server_revision ?? null,
        })
      } catch {
        // Realtime frames without the signal table's safe revision metadata are ignored.
      }
    }))
  }

  const serverRow = async () => {
    const result = await fixture.admin.from('September_2026')
      .select('"Full Name", "Phone Number", Age')
      .eq('id', fixture.septemberMemberId).single()
    if (result.error) throw result.error
    return result.data
  }
  const latestRevision = async () => {
    const result = await fixture.admin.from('member_v2_change_events')
      .select('server_revision')
      .eq('owner_id', fixture.userId)
      .eq('member_id', fixture.septemberMemberId)
      .order('server_revision', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (result.error) throw result.error
    return result.data?.server_revision ?? null
  }
  const openEdit = async (targetPage, cardName) => {
    await getVisibleMemberCard(targetPage, fixture, cardName).getByRole('button').first().click()
    await targetPage.getByRole('button', { name: 'Edit Details', exact: true }).click()
    await expect(targetPage.getByTestId('edit-member-modal')).toBeVisible()
  }

  try {
    await installMemberIdTrace(clientB, fixture)
    await signInToRealDatser(page, fixture)
    await dismissLocalUiPrompts(page)
    await signInToRealDatser(clientB, fixture)
    await dismissLocalUiPrompts(clientB)
    independentSignalChannel = fixture.client.channel(`member-v2-signal-probe:${fixture.userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals', filter: `owner_id=eq.${fixture.userId}` }, (payload) => {
        independentSignalEvents.push(payload?.new?.latest_server_revision ?? null)
      })
      .subscribe((status) => independentSignalStatuses.push(status))
    await expect.poll(() => independentSignalStatuses.includes('SUBSCRIBED'), { timeout: 10000 }).toBe(true)
    await expect.poll(latestRevision).not.toBeNull()
    evidence.openingRevision = await latestRevision()

    // Client B opens the real modal and makes a local edit first so the session
    // is dirty before Client A's authoritative refresh arrives.
    await openEdit(clientB, fixture.originalName)
    await expect(clientB.getByTestId('edit-form-full-name')).toHaveValue(fixture.originalName)
    await expect(clientB.getByTestId('edit-form-phone')).toHaveValue('5555555555')
    await clientB.getByTestId('edit-form-phone').fill('1666000000')

    // Client A performs a separate real UI edit while B's dirty modal remains open.
    await openEdit(page, fixture.originalName)
    await page.getByTestId('edit-form-full-name').fill(fixture.editedName)
    await page.getByTestId('edit-form-submit').click()
    await expect(getVisibleMemberCard(page, fixture, fixture.editedName).first()).toBeVisible({ timeout: 30000 })
    await expect.poll(async () => (await serverRow())['Full Name']).toBe(fixture.editedName)
    evidence.remoteRevision = await latestRevision()
    const signal = await fixture.admin.from('member_v2_realtime_signals')
      .select('latest_server_revision')
      .eq('owner_id', fixture.userId)
      .order('signal_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (signal.error) throw signal.error
    evidence.serverSignalRevision = signal.data?.latest_server_revision ?? null
    const authenticatedSignal = await clientB.evaluate(async ({ url, anonKey, ownerId, revision }) => {
      let sessionEntry = null
      try { sessionEntry = JSON.parse(localStorage.getItem('tmh-teen-auth') || 'null') } catch {}
      if (typeof sessionEntry?.access_token !== 'string') sessionEntry = null
      if (!sessionEntry) return { httpStatus: null, errorCode: 'NO_AUTH_SESSION' }
      const endpoint = new URL('/rest/v1/member_v2_realtime_signals', url)
      endpoint.searchParams.set('select', 'signal_id,owner_id,latest_server_revision,created_at')
      endpoint.searchParams.set('owner_id', `eq.${ownerId}`)
      endpoint.searchParams.set('latest_server_revision', `eq.${revision}`)
      const response = await fetch(endpoint, {
        headers: { apikey: anonKey, Authorization: `Bearer ${sessionEntry.access_token}` },
      })
      let body = null
      try { body = await response.json() } catch {}
      const row = Array.isArray(body) ? body[0] : null
      return {
        httpStatus: response.status,
        errorCode: body?.code || null,
        visible: response.ok && Boolean(row),
        signalId: row?.signal_id ?? null,
        ownerMatches: row?.owner_id === ownerId,
        revisionMatches: Number(row?.latest_server_revision) === Number(revision),
        createdAt: row?.created_at ?? null,
      }
    }, { url: local.url, anonKey: local.anonKey, ownerId: fixture.userId, revision: evidence.serverSignalRevision })
    evidence.authenticatedSignalVisible = authenticatedSignal.visible === true
    evidence.authenticatedSignalHttpStatus = authenticatedSignal.httpStatus
    evidence.authenticatedSignalOwnerMatches = authenticatedSignal.ownerMatches === true
    evidence.authenticatedSignalRevisionMatches = authenticatedSignal.revisionMatches === true
    evidence.authenticatedSignalId = authenticatedSignal.signalId ?? null
    evidence.authenticatedSignalCreatedAt = authenticatedSignal.createdAt ?? null
    evidence.authenticatedSignalErrorCode = authenticatedSignal.errorCode ?? null
    await expect.poll(() => independentSignalEvents.includes(evidence.serverSignalRevision), { timeout: 5000 })
      .toBe(true)
      .catch(() => {})

    const readClientBDiagnostic = () => clientB.evaluate((memberId) => {
      const diagnostic = window.__datserMemberV2DashboardDiagnostic
      const appContext = (diagnostic?.appContextRows || []).find((row) => String(row.id) === memberId)
      const visible = (diagnostic?.visibleRows || []).find((row) => String(row.id) === memberId)
      return {
        appContextRevision: appContext?.serverRevision ?? null,
        appContextMatchesRemote: appContext?.profileValueMatches === true,
        visibleRevision: visible?.serverRevision ?? null,
        visibleMatchesRemote: visible?.profileValueMatches === true,
      }
    }, fixture.septemberMemberId)
    await expect.poll(readClientBDiagnostic, { timeout: 30000 }).toMatchObject({
      appContextRevision: evidence.remoteRevision,
      appContextMatchesRemote: true,
      visibleRevision: evidence.remoteRevision,
      visibleMatchesRemote: true,
    })
    evidence.clientBObservedRemoteRevision = true

    await expect(clientB.getByTestId('edit-member-modal')).toBeVisible()
    evidence.modalStayedOpen = true
    evidence.baselineNameStayedStable = await clientB.getByTestId('edit-form-full-name').inputValue() === fixture.originalName
    evidence.localPhoneStayedStable = await clientB.getByTestId('edit-form-phone').inputValue() === '1666000000'
    expect(evidence.baselineNameStayedStable).toBe(true)
    expect(evidence.localPhoneStayedStable).toBe(true)

    await clientB.getByTestId('edit-form-age').fill('19')
    await clientB.getByTestId('edit-form-submit').click()
    await expect(clientB.getByTestId('edit-member-modal')).toBeHidden({ timeout: 15000 })
    await expect.poll(async () => {
      const row = await serverRow()
      return String(row.Age)
    }).toBe('19')
    const finalRow = await serverRow()
    evidence.finalRevision = await latestRevision()
    evidence.finalFullNameMatchesRemote = finalRow['Full Name'] === fixture.editedName
    evidence.finalPhoneMatchesLocalEdit = String(finalRow['Phone Number']) === '1666000000'
    evidence.finalAgeMatchesLocalEdit = String(finalRow.Age) === '19'
    evidence.observedMutationOwners = [...new Set(mutationCalls.map(({ operation }) => operation))]
    evidence.submittedFieldKeys = mutationCalls.map(({ client, operation, fieldKeys }) => ({ client: client === page ? 'A' : 'B', operation, fieldKeys }))

    expect(evidence.finalFullNameMatchesRemote).toBe(true)
    expect(evidence.finalPhoneMatchesLocalEdit).toBe(true)
    expect(evidence.finalAgeMatchesLocalEdit).toBe(true)
    expect(mutationCalls.filter(({ client }) => client === page)).toHaveLength(1)
    expect(mutationCalls.filter(({ client }) => client === clientB)).toHaveLength(1)
    expect(mutationCalls.find(({ client }) => client === page)?.fieldKeys).toEqual(['Full Name'])
    expect(mutationCalls.find(({ client }) => client === clientB)?.fieldKeys).toEqual(['Age', 'Phone Number'])

    await clientB.reload()
    await expect(getVisibleMemberCard(clientB, fixture, fixture.editedName).first()).toBeVisible({ timeout: 30000 })
    const reloadedRow = await serverRow()
    expect(reloadedRow['Full Name']).toBe(fixture.editedName)
    expect(String(reloadedRow['Phone Number'])).toBe('1666000000')
    expect(String(reloadedRow.Age)).toBe('19')
  } finally {
    const finalClientBDiagnostic = await clientB.evaluate((memberId) => {
      const dashboard = window.__datserMemberV2DashboardDiagnostic
      const appContext = (dashboard?.appContextRows || []).find((row) => String(row.id) === memberId)
      const visible = (dashboard?.visibleRows || []).find((row) => String(row.id) === memberId)
      const events = (window.__datserMemberV2IdTrace?.events || [])
        .filter((event) => event.id === memberId || String(event.stage || '').startsWith('member-v2-realtime-'))
        .slice(-20)
        .map((event) => ({
          at: event.at,
          stage: event.stage,
          revision: event.serverRevision ?? event.nextRevision ?? event.latestServerRevision ?? null,
          status: event.status ?? null,
          present: event.present ?? null,
          nextCursor: event.nextCursor ?? null,
          comparatorEqual: event.comparatorEqual ?? null,
        }))
      return {
        appContextRevision: appContext?.serverRevision ?? null,
        appContextMatchesRemote: appContext?.profileValueMatches === true,
        visibleRevision: visible?.serverRevision ?? null,
        visibleMatchesRemote: visible?.profileValueMatches === true,
        events,
      }
    }, fixture.septemberMemberId).catch(() => null)
    evidence.observedMutationOwners = [...new Set(mutationCalls.map(({ operation }) => operation))]
    evidence.submittedFieldKeys = mutationCalls.map(({ client: source, operation, fieldKeys }) => ({ client: source === page ? 'A' : 'B', operation, fieldKeys }))
    evidence.pullEvents = pullEvents.slice(-20)
    evidence.realtimeSignalEvents = realtimeSignalEvents.slice(-20)
    evidence.finalClientBDiagnostic = finalClientBDiagnostic
    const realtimeServiceEvents = (finalClientBDiagnostic?.events || [])
      .filter((event) => String(event.stage || '').startsWith('member-v2-realtime-'))
    const safeEvidence = {
      ...evidence,
      submittedFieldKeys: evidence.submittedFieldKeys,
      memberId: fixture.septemberMemberId,
    }
    console.log('MEMBER_V2_MODAL_REFRESH_ID_ONLY', JSON.stringify({
      id: safeEvidence.id,
      tableName: safeEvidence.tableName,
      openingRevision: safeEvidence.openingRevision,
      remoteRevision: safeEvidence.remoteRevision,
      serverSignalRevision: safeEvidence.serverSignalRevision,
      authenticatedSignalVisible: safeEvidence.authenticatedSignalVisible,
      authenticatedSignalHttpStatus: safeEvidence.authenticatedSignalHttpStatus,
      authenticatedSignalOwnerMatches: safeEvidence.authenticatedSignalOwnerMatches,
      authenticatedSignalRevisionMatches: safeEvidence.authenticatedSignalRevisionMatches,
      authenticatedSignalId: safeEvidence.authenticatedSignalId,
      authenticatedSignalCreatedAt: safeEvidence.authenticatedSignalCreatedAt,
      authenticatedSignalErrorCode: safeEvidence.authenticatedSignalErrorCode,
      clientBObservedRemoteRevision: safeEvidence.clientBObservedRemoteRevision,
      finalClientBAppContextRevision: finalClientBDiagnostic?.appContextRevision ?? null,
      finalClientBVisibleRevision: finalClientBDiagnostic?.visibleRevision ?? null,
      mutationOwners: safeEvidence.observedMutationOwners,
      submittedFieldKeys: safeEvidence.submittedFieldKeys,
      pullEvents: pullEvents.filter((event) => event.client === 'B' && event.stage !== 'realtime-frame-received'),
      realtimeServiceEvents,
      independentSignalStatuses,
      independentSignalRevisionReceived: independentSignalEvents.includes(evidence.serverSignalRevision),
    }))
    await testInfo.attach('member-v2-modal-refresh-id-only.json', {
      body: Buffer.from(JSON.stringify(safeEvidence, null, 2)),
      contentType: 'application/json',
    })
    await clientB.close().catch(() => {})
    if (independentSignalChannel) await fixture.client.removeChannel(independentSignalChannel).catch(() => {})
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})

test('diagnostic captures one local Realtime WAL signal window without modal interaction', async ({ browser }, testInfo) => {
  const fixture = await createFixture({ phoneNumber: '5555555555' })
  const clientB = await browser.newPage()
  const rawSignalRevisions = []
  const rawSignalStatuses = []
  const unfilteredControlRevisions = []
  const unfilteredControlStatuses = []
  const pullEvents = []
  let rawChannel = null
  let unfilteredControlChannel = null
  let windowStartedAt = null
  const evidence = {
    memberId: fixture.septemberMemberId,
    ownerId: fixture.userId,
    tableName: 'September_2026',
    clientBServiceStatusesBeforeMutation: [],
    rawStatusesBeforeMutation: [],
    unfilteredControlStatusesBeforeMutation: [],
    baselineSignal: null,
    walBefore: null,
    mutationRevision: null,
    signalAfter: null,
    authenticatedSignalRead: null,
    walAfter: null,
    rawSignalRevisions: [],
    unfilteredControlRevisions: [],
    clientBServiceEventsAfterWindow: [],
    clientBPullsAfterWindow: [],
  }
  try {
    await installMemberIdTrace(clientB, fixture)
    watchMemberPulls(clientB, fixture, pullEvents, 'B')
    const websocketSignalFrames = []
    clientB.on('websocket', (socket) => socket.on('framereceived', (frame) => {
      try {
        const content = typeof frame === 'string' ? frame
          : Buffer.isBuffer(frame) ? frame.toString('utf8')
            : frame instanceof ArrayBuffer ? Buffer.from(frame).toString('utf8')
              : ArrayBuffer.isView(frame) ? Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('utf8')
                : null
        if (!content) return
        const decoded = JSON.parse(content)
        const data = decoded?.payload?.data || decoded?.payload || {}
        if (data?.table !== 'member_v2_realtime_signals') return
        const row = data.record || data.new || {}
        websocketSignalFrames.push({ type: data.type || null, revision: row.latest_server_revision ?? null })
      } catch {
        // Store only parsed signal metadata. Never retain or print raw frames.
      }
    }))

    await signInToRealDatser(clientB, fixture, null, { waitForMemberCard: false })
    await expect.poll(async () => clientB.evaluate(() =>
      (window.__datserMemberV2IdTrace?.events || [])
        .some((event) => event.stage === 'member-v2-realtime-channel-status' && event.status === 'SUBSCRIBED')), { timeout: 10000 }).toBe(true)
    evidence.walAfterServiceJoin = readLocalRealtimeWalSnapshot(fixture.userId)

    rawChannel = fixture.client.channel(`member-v2-wal-probe:${fixture.userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals',
        filter: `owner_id=eq.${fixture.userId}`,
      }, (payload) => rawSignalRevisions.push(payload?.new?.latest_server_revision ?? null))
      .subscribe((status) => rawSignalStatuses.push(status))
    await expect.poll(() => rawSignalStatuses.includes('SUBSCRIBED'), { timeout: 10000 }).toBe(true)
    evidence.walAfterFilteredJoin = readLocalRealtimeWalSnapshot(fixture.userId)

    unfilteredControlChannel = fixture.client.channel(`member-v2-wal-unfiltered-control:${fixture.userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals',
      }, (payload) => unfilteredControlRevisions.push(payload?.new?.latest_server_revision ?? null))
      .subscribe((status) => unfilteredControlStatuses.push(status))
    await expect.poll(() => unfilteredControlStatuses.includes('SUBSCRIBED'), { timeout: 10000 }).toBe(true)

    const baselineSignalResult = await fixture.admin.from('member_v2_realtime_signals')
      .select('signal_id, latest_server_revision, created_at')
      .eq('owner_id', fixture.userId)
      .order('signal_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (baselineSignalResult.error) throw baselineSignalResult.error
    evidence.baselineSignal = baselineSignalResult.data
    evidence.walBefore = readLocalRealtimeWalSnapshot(fixture.userId)
    evidence.clientBServiceStatusesBeforeMutation = await clientB.evaluate(() =>
      (window.__datserMemberV2IdTrace?.events || [])
        .filter((event) => event.stage === 'member-v2-realtime-channel-status')
        .map((event) => ({ at: event.at, status: event.status })))
    evidence.rawStatusesBeforeMutation = [...rawSignalStatuses]
    evidence.unfilteredControlStatusesBeforeMutation = [...unfilteredControlStatuses]
    windowStartedAt = new Date().toISOString()
    evidence.windowStartedAt = windowStartedAt

    const baseRevisionResult = await fixture.admin.from('member_v2_change_events')
      .select('server_revision')
      .eq('owner_id', fixture.userId)
      .eq('member_id', fixture.septemberMemberId)
      .order('server_revision', { ascending: false })
      .limit(1)
      .single()
    if (baseRevisionResult.error) throw baseRevisionResult.error
    const updates = { 'Full Name': fixture.editedName }
    const requestId = crypto.randomUUID()
    const fingerprint = await createMemberV2Fingerprint({
      operation: 'update_member_v2', ownerId: fixture.userId, tableName: 'September_2026',
      memberId: fixture.septemberMemberId, baseServerRevision: baseRevisionResult.data.server_revision,
      payload: updates,
    })
    const mutation = await fixture.client.rpc('update_member_v2', {
      p_table_name: 'September_2026',
      p_owner_id: fixture.userId,
      p_member_id: fixture.septemberMemberId,
      p_updates: updates,
      p_base_server_revision: baseRevisionResult.data.server_revision,
      p_request_id: requestId,
      p_payload_fingerprint: fingerprint,
      p_identity: {},
    })
    if (mutation.error) throw mutation.error
    evidence.mutationRevision = mutation.data?.server_revision ?? null

    const signalAfterResult = await fixture.admin.from('member_v2_realtime_signals')
      .select('signal_id, owner_id, latest_server_revision, created_at')
      .eq('owner_id', fixture.userId)
      .eq('latest_server_revision', evidence.mutationRevision)
      .maybeSingle()
    if (signalAfterResult.error) throw signalAfterResult.error
    evidence.signalAfter = signalAfterResult.data
    evidence.walAfter = readLocalRealtimeWalSnapshot(fixture.userId)
    evidence.authenticatedSignalRead = await clientB.evaluate(async ({ url, anonKey, ownerId, revision }) => {
      let session = null
      try { session = JSON.parse(localStorage.getItem('tmh-teen-auth') || 'null') } catch {}
      if (typeof session?.access_token !== 'string') return { httpStatus: null, errorCode: 'NO_AUTH_SESSION' }
      const endpoint = new URL('/rest/v1/member_v2_realtime_signals', url)
      endpoint.searchParams.set('select', 'signal_id,owner_id,latest_server_revision,created_at')
      endpoint.searchParams.set('owner_id', `eq.${ownerId}`)
      endpoint.searchParams.set('latest_server_revision', `eq.${revision}`)
      const response = await fetch(endpoint, { headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` } })
      let body = null
      try { body = await response.json() } catch {}
      const row = Array.isArray(body) ? body[0] : null
      return {
        httpStatus: response.status,
        visible: response.ok && Boolean(row),
        ownerMatches: row?.owner_id === ownerId,
        revisionMatches: Number(row?.latest_server_revision) === Number(revision),
      }
    }, { url: local.url, anonKey: local.anonKey, ownerId: fixture.userId, revision: evidence.mutationRevision })

    await expect.poll(() => rawSignalRevisions.includes(evidence.mutationRevision), { timeout: 5000 }).toBe(true).catch(() => {})
    await expect.poll(() => unfilteredControlRevisions.includes(evidence.mutationRevision), { timeout: 5000 }).toBe(true).catch(() => {})
    await clientB.waitForFunction((revision) =>
      (window.__datserMemberV2IdTrace?.events || []).some((event) =>
        event.stage === 'member-v2-realtime-signal-received' && Number(event.latestServerRevision) === Number(revision)),
    evidence.mutationRevision, { timeout: 5000, polling: 50 })
    await expect.poll(() => pullEvents.some((event) => event.client === 'B' && event.stage === 'pull-response' && Number(event.revision) === Number(evidence.mutationRevision)), { timeout: 10000 })
      .toBe(true)
    evidence.walAfter = readLocalRealtimeWalSnapshot(fixture.userId)
    evidence.rawSignalRevisions = [...rawSignalRevisions]
    evidence.unfilteredControlRevisions = [...unfilteredControlRevisions]
    evidence.websocketSignalFrames = websocketSignalFrames
    evidence.clientBServiceEventsAfterWindow = await clientB.evaluate(() =>
      (window.__datserMemberV2IdTrace?.events || [])
        .filter((event) => String(event.stage || '').startsWith('member-v2-realtime-'))
        .map((event) => ({ at: event.at, stage: event.stage, status: event.status ?? null, revision: event.latestServerRevision ?? event.serverRevision ?? null })))
    evidence.clientBPullsAfterWindow = pullEvents.filter((event) => event.client === 'B')
    const realtimeSlotBefore = evidence.walBefore.realtimeSlots.find((slot) =>
      slot.active && slot.plugin === 'wal2json' && slot.name.startsWith('supabase_realtime_replication_slot_'))
    const realtimeSlotAfter = evidence.walAfter.realtimeSlots.find((slot) => slot.name === realtimeSlotBefore?.name)
    expect(evidence.authenticatedSignalRead).toMatchObject({ httpStatus: 200, visible: true, ownerMatches: true, revisionMatches: true })
    // Two application services, the temporary unfiltered control, and the
    // intentionally filtered negative control are registered in this local DB.
    expect(evidence.walBefore.registeredSubscriptions).toHaveLength(4)
    expect(evidence.walBefore.registeredSubscriptions.filter((row) => row.filters === '{}')).toHaveLength(3)
    expect(evidence.walBefore.registeredSubscriptions.filter((row) => row.filters !== '{}')).toHaveLength(1)
    expect(evidence.walAfter.signalTableSubscriptionCount).toBeGreaterThanOrEqual(2)
    expect(realtimeSlotBefore?.active).toBe(true)
    expect(realtimeSlotAfter?.active).toBe(true)
    expect(realtimeSlotAfter?.confirmedFlushLsn).not.toBe(realtimeSlotBefore?.confirmedFlushLsn)
    expect(evidence.rawSignalRevisions).toContain(evidence.mutationRevision)
    expect(evidence.unfilteredControlRevisions).toContain(evidence.mutationRevision)
    expect(evidence.clientBServiceEventsAfterWindow.some((event) => event.stage === 'member-v2-realtime-signal-received' && Number(event.revision) === Number(evidence.mutationRevision))).toBe(true)
    expect(evidence.clientBPullsAfterWindow.some((event) => event.stage === 'pull-response' && Number(event.revision) === Number(evidence.mutationRevision))).toBe(true)
  } finally {
    evidence.windowFinishedAt = new Date().toISOString()
    evidence.rawSignalRevisions = [...rawSignalRevisions]
    evidence.unfilteredControlRevisions = [...unfilteredControlRevisions]
    if (windowStartedAt) {
      evidence.websocketSignalFrames = evidence.websocketSignalFrames || []
      const browserState = await clientB.evaluate(() => ({
        events: (window.__datserMemberV2IdTrace?.events || [])
          .filter((event) => String(event.stage || '').startsWith('member-v2-realtime-'))
          .map((event) => ({ at: event.at, stage: event.stage, status: event.status ?? null, revision: event.latestServerRevision ?? event.serverRevision ?? null })),
      })).catch(() => ({ events: [] }))
      evidence.clientBServiceEventsAfterWindow = browserState.events
      evidence.clientBPullsAfterWindow = pullEvents.filter((event) => event.client === 'B')
    }
    console.log('MEMBER_V2_REALTIME_WAL_CDC_ID_ONLY', JSON.stringify(evidence))
    await testInfo.attach('member-v2-realtime-wal-cdc-id-only.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json',
    })
    await clientB.close().catch(() => {})
    if (rawChannel) await fixture.client.removeChannel(rawChannel).catch(() => {})
    if (unfilteredControlChannel) await fixture.client.removeChannel(unfilteredControlChannel).catch(() => {})
    await fixture.admin.auth.admin.deleteUser(fixture.userId)
  }
})
