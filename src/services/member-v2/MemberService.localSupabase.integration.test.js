// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { acquireLocalSupabaseIntegrationLock, readLocalSupabase, readLocalSupabaseDbContainer } from '../../experiments/rxdb-backend-poc/testing/localSupabaseFixture'
import { createMemberV2Fingerprint } from '../../experiments/rxdb-member-phase1/memberContractFingerprint'
import { createMemberService } from './MemberService'
import { createMemberAttendanceService } from './MemberAttendanceService'
import { createMemberV2AttendanceFingerprint } from '../../experiments/rxdb-member-phase1/attendanceContractFingerprint'
import { MEMBER_SAVE_STATES } from './memberSaveState'
import { createMemberV2NetworkController } from '../../experiments/rxdb-member-phase1/NetworkController'
import { vi } from 'vitest'

const fixture = {}; const storage = getRxStorageMemory()
let releaseLocalSupabaseLock
const safeRealtimeError = (error) => String(error?.message || '')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/(apikey|access_token)=([^&\s]+)/gi, '$1=[redacted]')
  .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[redacted]')

const execFileAsync = promisify(execFile)
const psqlProcess = (applicationName) => {
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const child = spawn(docker, ['exec', '-i', '-e', `PGAPPNAME=${applicationName}`, readLocalSupabaseDbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''; let error = ''; child.stdout.on('data', (chunk) => { output += chunk.toString() }); child.stderr.on('data', (chunk) => { error += chunk.toString() })
  return { child, output: () => output, error: () => error, send: (sql) => child.stdin.write(`${sql}\n`), finish: async () => { child.stdin.end('\\q\n'); await new Promise((resolve, reject) => { child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`psql exited ${code}: ${error}`))) }) } }
}
const waitForPsql = async (process, marker, timeoutMs = 5000) => {
  const start = Date.now()
  while (!process.output().includes(marker)) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for local SQL transaction marker ${marker}. ${process.error()}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
const waitForLockWait = async (applicationName, session = null) => {
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const start = Date.now()
  while (Date.now() - start < 5000) {
    const { stdout } = await execFileAsync(docker, ['exec', '-i', readLocalSupabaseDbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c', `select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${applicationName}' and state='active' order by query_start desc limit 1`], { encoding: 'utf8' })
    if (stdout.trim() === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Local SQL transaction ${applicationName} did not enter an advisory-lock wait. ${session?.output() || ''} ${session?.error() || ''}`)
}
const inspectLocalSignalRealtime = async (ownerId) => {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error('Synthetic owner UUID is invalid.')
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const container = readLocalSupabaseDbContainer()
  const query = `select json_build_object(
    'rlsEnabled', (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='member_v2_realtime_signals'),
    'subscriptions', coalesce((select json_agg(json_build_object('subscriptionId',subscription_id::text,'entity',entity::text,'event',action_filter,'filters',filters::text,'role',claims_role::text,'createdAt',created_at) order by subscription_id) from realtime.subscription where entity=to_regclass('public.member_v2_realtime_signals') and claims->>'sub'='${ownerId}'),'[]'::json)
  )::text;`
  const { stdout } = await execFileAsync(docker, ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-c', query], { encoding: 'utf8' })
  return JSON.parse(stdout.trim())
}

beforeAll(async () => {
  releaseLocalSupabaseLock = await acquireLocalSupabaseIntegrationLock()
  const config = readLocalSupabase(); fixture.config = config; fixture.admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `member-v2-client-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@local.invalid`; const password = `MemberV2-${crypto.randomUUID()}-9a!`
  fixture.email = email; fixture.password = password
  const created = await fixture.admin.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error) throw created.error
  fixture.userId = created.data.user.id
  const otherUser = await fixture.admin.auth.admin.createUser({ email: `member-v2-other-${crypto.randomUUID().slice(0, 8)}@local.invalid`, password: `MemberV2-${crypto.randomUUID()}-9a!`, email_confirm: true }); if (otherUser.error) throw otherUser.error
  fixture.otherOwnerId = otherUser.data.user.id
  fixture.client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const rollout = await fixture.admin.from('member_v2_rollout_workspaces').upsert({ owner_id: fixture.userId, enabled: true })
  if (rollout.error) throw rollout.error
  const rolloutCheck = await fixture.admin.from('member_v2_rollout_workspaces').select('enabled').eq('owner_id', fixture.userId).single()
  if (rolloutCheck.error || rolloutCheck.data?.enabled !== true) throw rolloutCheck.error || new Error('Synthetic test workspace rollout gate did not persist.')
  const login = await fixture.client.auth.signInWithPassword({ email, password }); if (login.error) throw login.error
  await fixture.client.realtime.setAuth(login.data.session.access_token)
  const month = await fixture.client.rpc('create_workspace_month', { p_owner_id: fixture.userId, p_year: 2025, p_month: 12, p_source_month: null, p_copy_mode: 'empty', p_member_ids: [] })
  if (month.error) throw month.error; fixture.tableName = month.data.table_name
  if (!/^[A-Z][a-z]+_\d{4}$/.test(fixture.tableName)) throw new Error('Synthetic workspace month table name is invalid.')
  await execFileAsync(process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker', [
    'exec', '-i', readLocalSupabaseDbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', `alter table public."${fixture.tableName}" add column if not exists deleted_at timestamptz;`,
  ], { encoding: 'utf8' })
  for (const attendanceDate of ['2025-12-07', '2025-12-14', '2025-12-21', '2025-12-28']) {
    const column = await fixture.client.rpc('ensure_workspace_attendance_column', { p_owner_id: fixture.userId, p_month_start: '2025-12-01', p_attendance_date: attendanceDate })
    if (column.error) throw column.error
  }
}, 180000)

afterAll(async () => {
  try {
    if (fixture.userId) await fixture.admin.auth.admin.deleteUser(fixture.userId)
    if (fixture.otherOwnerId) await fixture.admin.auth.admin.deleteUser(fixture.otherOwnerId)
  } finally { await releaseLocalSupabaseLock?.() }
})

describe.sequential('Member V2 service with local authenticated Supabase', () => {
  const assertSameRowWriterOrder = async (kind) => {
    const ownerId = fixture.userId
    const service = await createMemberService({ supabase: fixture.client, userId: ownerId, ownerId, storage: getRxStorageMemory(), online: () => true })
    await service.start()
    let attendanceService
    const suffix = crypto.randomUUID().slice(0, 8)
    const first = psqlProcess(`datser-same-row-first-${suffix}`)
    const secondName = `datser-same-row-second-${suffix}`
    const second = psqlProcess(secondName)
    try {
      const member = await service.createMember({ tableName: fixture.tableName, member: { full_name: `Synthetic same row ${suffix}`, current_level: 'JHS2' } })
      await service.syncNow()
      let base = Number((await service.getMember(member.id)).server_revision)
      if (kind === 'attendance') {
        attendanceService = await createMemberAttendanceService({ supabase: fixture.client, userId: ownerId, ownerId, storage: getRxStorageMemory(), online: () => true })
        await attendanceService.start()
        await attendanceService.saveAttendance({ memberId: member.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status: 'Present' })
        await attendanceService.syncNow()
        const latest = await fixture.admin.from('member_v2_change_events').select('server_revision').eq('owner_id', ownerId).eq('member_id', member.id).eq('attendance_date', '2025-12-07').order('server_revision', { ascending: false }).limit(1).single()
        if (latest.error) throw latest.error
        base = Number(latest.data.server_revision)
      }
      const latest = await fixture.admin.from('member_v2_change_events').select('server_revision').eq('owner_id', ownerId).order('server_revision', { ascending: false }).limit(1).single()
      if (latest.error) throw latest.error
      const cursor = latest.data.server_revision
      // Hold ONLY the broad lock. Previously a delete/legacy UPDATE could take
      // this same member's head/physical row and then wait for this owner lock.
      first.send(`begin; set local request.jwt.claim.sub = '${ownerId}'; select public.member_v2_lock_change_event_order('${ownerId}');\n\\echo SAME_ROW_OWNER_HELD`)
      await waitForPsql(first, 'SAME_ROW_OWNER_HELD')
      const actor = `set local role authenticated; set local request.jwt.claim.sub = '${ownerId}';`
      let secondSql
      if (kind === 'delete') {
        const fingerprint = await createMemberV2Fingerprint({ operation: 'delete_member_v2', ownerId, tableName: fixture.tableName, memberId: member.id, baseServerRevision: base, payload: {} })
        secondSql = `select public.delete_member_v2('${fixture.tableName}', '${ownerId}', '${member.id}', ${base}, 'same-row-delete-${suffix}', '${fingerprint}');`
      } else {
        const column = kind === 'attendance' ? 'attendance_2025_12_07' : 'Current Level'
        const value = kind === 'attendance' ? 'Present' : 'SHS1'
        secondSql = `update public."${fixture.tableName}" set "${column}" = '${value}' where id = '${member.id}' and workspace_owner_id = '${ownerId}';`
      }
      second.send(`begin; ${actor} ${secondSql} commit;\n\\echo SAME_ROW_SECOND_DONE`)
      await waitForLockWait(secondName, second)
      if (kind === 'attendance') {
        const fingerprint = await createMemberV2AttendanceFingerprint({ operation: 'set_member_v2_attendance', ownerId, memberId: member.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status: 'Absent', baseServerRevision: base })
        first.send(`select public.save_member_v2_attendance('${ownerId}', '${member.id}', '${fixture.tableName}', '2025-12-07', 'Absent', null, ${base}, 'same-row-first-${suffix}', '${fingerprint}'); commit;\n\\echo SAME_ROW_FIRST_DONE`)
      } else {
        const updates = { 'Current Level': 'JHS3' }
        const fingerprint = await createMemberV2Fingerprint({ operation: 'update_member_v2', ownerId, tableName: fixture.tableName, memberId: member.id, baseServerRevision: base, payload: updates })
        first.send(`select public.update_member_v2('${fixture.tableName}', '${ownerId}', '${member.id}', '${JSON.stringify(updates)}'::jsonb, ${base}, 'same-row-first-${suffix}', '${fingerprint}', '{}'::jsonb); commit;\n\\echo SAME_ROW_FIRST_DONE`)
      }
      await Promise.all([waitForPsql(first, 'SAME_ROW_FIRST_DONE', 10000), waitForPsql(second, 'SAME_ROW_SECOND_DONE', 10000)])
      expect(first.error()).not.toMatch(/deadlock|ERROR/)
      expect(second.error()).not.toMatch(/deadlock|ERROR/)
      if (kind === 'delete') {
        // The intervening update makes the old base conflict. Reconcile, then
        // submit the last delete intent against the confirmed revision.
        expect(second.output()).toContain('CONFLICT')
        const head = await fixture.admin.from('member_v2_heads').select('server_revision').eq('owner_id', ownerId).eq('member_id', member.id).eq('table_name', fixture.tableName).single()
        if (head.error) throw head.error
        const nextBase = Number(head.data.server_revision)
        const fingerprint = await createMemberV2Fingerprint({ operation: 'delete_member_v2', ownerId, tableName: fixture.tableName, memberId: member.id, baseServerRevision: nextBase, payload: {} })
        const deleted = await fixture.client.rpc('delete_member_v2', { p_table_name: fixture.tableName, p_owner_id: ownerId, p_member_id: member.id, p_base_server_revision: nextBase, p_request_id: `same-row-delete-reconciled-${suffix}`, p_payload_fingerprint: fingerprint })
        if (deleted.error) throw deleted.error
        expect(deleted.data.status).toBe('SUCCESS')
      }
      const pull = kind === 'attendance'
        ? await fixture.client.rpc('pull_member_v2_attendance_changes_v2', { p_owner_id: ownerId, p_after_server_revision: cursor, p_limit: 100 })
        : await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: ownerId, p_after_server_revision: cursor, p_limit: 100 })
      if (pull.error) throw pull.error
      const events = pull.data.changes.filter((row) => row.member_id === member.id)
      expect(events).toHaveLength(2)
      expect(Number(events[0].server_revision)).toBeLessThan(Number(events[1].server_revision))
      const row = await fixture.admin.from(fixture.tableName).select('*').eq('id', member.id).eq('workspace_owner_id', ownerId).single()
      if (row.error) throw row.error
      if (kind === 'delete') {
        expect(row.data.deleted_at).toBeTruthy()
        expect(events.filter((event) => event.is_deleted)).toHaveLength(1)
      } else if (kind === 'attendance') {
        expect(row.data.attendance_2025_12_07).toBe('Present')
      } else {
        expect(row.data['Current Level']).toBe('SHS1')
        expect(events[1].operation).toBe('update')
      }
    } finally {
      for (const session of [first, second]) {
        if (session.child.exitCode === null) { session.send('rollback;'); await session.finish() }
      }
      await attendanceService?.stop()
      await service.stop()
    }
  }

  it.each(['delete', 'profile', 'attendance'])('coordinates a same-row %s contender before it takes narrow locks', async (kind) => {
    await assertSameRowWriterOrder(kind)
  }, 30000)

  const assertCommitOrderedFeedPair = async (feed, rollbackFirst = false) => {
    const ownerId = fixture.userId; const memberA = crypto.randomUUID(); const memberB = crypto.randomUUID(); const otherOwner = fixture.otherOwnerId; const otherMember = crypto.randomUUID()
    const latest = await fixture.admin.from('member_v2_change_events').select('server_revision').eq('owner_id', ownerId).order('server_revision', { ascending: false }).limit(1).maybeSingle()
    if (latest.error) throw latest.error
    const afterRevision = latest.data?.server_revision || 0; const applicationA = `datser-order-a-${crypto.randomUUID().slice(0, 8)}`; const applicationB = `datser-order-b-${crypto.randomUUID().slice(0, 8)}`; const applicationOther = `datser-order-o-${crypto.randomUUID().slice(0, 8)}`
    const first = psqlProcess(applicationA); const second = psqlProcess(applicationB); const other = psqlProcess(applicationOther)
    const eventSql = (owner, member, status) => feed === 'profile'
      ? `select public.member_v2_record_change('${owner}', '${fixture.tableName}', '${member}', '{}'::jsonb, false, 'ordering_test', '${crypto.randomUUID()}', '${owner}')`
      : `select public.member_v2_record_attendance_change('${owner}', '${fixture.tableName}', '${member}', '2025-12-07'::date, '${status}', false, 'ordering_test', '${crypto.randomUUID()}', '${owner}', '${crypto.randomUUID()}')`
    try {
      first.send(`begin;\n${eventSql(ownerId, memberA, 'Present')};\n\\echo ORDER_A_READY`)
      await waitForPsql(first, 'ORDER_A_READY')
      second.send(`begin;\n${eventSql(ownerId, memberB, feed === 'profile' ? 'Present' : 'Absent')};\n\\echo ORDER_B_READY`)
      await waitForLockWait(applicationB)
      // A different workspace must not wait on the first workspace's lock.
      other.send(`begin;\n${eventSql(otherOwner, otherMember, 'Present')};\ncommit;\n\\echo ORDER_OTHER_DONE`)
      await waitForPsql(other, 'ORDER_OTHER_DONE')
      const beforeCommit = feed === 'profile'
        ? await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: ownerId, p_after_server_revision: afterRevision, p_limit: 100 })
        : await fixture.client.rpc('pull_member_v2_attendance_changes_v2', { p_owner_id: ownerId, p_after_server_revision: afterRevision, p_limit: 100 })
      if (beforeCommit.error) throw beforeCommit.error
      expect((beforeCommit.data.changes || []).map((row) => row.member_id)).not.toEqual(expect.arrayContaining([memberA, memberB]))
      first.send(`${rollbackFirst ? 'rollback' : 'commit'};\n\\echo ORDER_A_FINISHED`); await waitForPsql(first, 'ORDER_A_FINISHED')
      await waitForPsql(second, 'ORDER_B_READY')
      second.send('commit;\n\\echo ORDER_B_COMMITTED'); await waitForPsql(second, 'ORDER_B_COMMITTED')
      const pulled = feed === 'profile'
        ? await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: ownerId, p_after_server_revision: afterRevision, p_limit: 100 })
        : await fixture.client.rpc('pull_member_v2_attendance_changes_v2', { p_owner_id: ownerId, p_after_server_revision: afterRevision, p_limit: 100 })
      if (pulled.error) throw pulled.error
      const changes = pulled.data.changes || []; const ownPair = changes.filter((row) => [memberA, memberB].includes(row.member_id))
      expect(ownPair.map((row) => row.member_id)).toEqual(rollbackFirst ? [memberB] : [memberA, memberB])
      if (!rollbackFirst) expect(ownPair[0].server_revision).toBeLessThan(ownPair[1].server_revision)
      expect(changes.some((row) => row.member_id === otherMember)).toBe(false)
      const next = feed === 'profile'
        ? await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: ownerId, p_after_server_revision: pulled.data.next_cursor, p_limit: 100 })
        : await fixture.client.rpc('pull_member_v2_attendance_changes_v2', { p_owner_id: ownerId, p_after_server_revision: pulled.data.next_cursor, p_limit: 100 })
      if (next.error) throw next.error
      expect((next.data.changes || []).filter((row) => [memberA, memberB].includes(row.member_id))).toEqual([])
    } finally {
      for (const session of [first, second, other]) { if (!session.child.killed && session.child.exitCode === null) { try { session.send('rollback;') } catch {} session.child.stdin.end('\\q\n') } }
      await Promise.all([first, second, other].map((session) => session.child.exitCode === null ? new Promise((resolve) => session.child.once('close', resolve)) : Promise.resolve()))
    }
  }

  const assertBootstrapWriterLockOrder = async (feed, sameMember = false) => {
    const ownerId = fixture.userId
    const memberService = await createMemberService({ supabase: fixture.client, userId: ownerId, ownerId, storage: getRxStorageMemory(), online: () => true })
    await memberService.start()
    let attendanceService = null
    const members = []
    const suffix = crypto.randomUUID().slice(0, 8)
    const gateKey = `datser-bootstrap-gate-${crypto.randomUUID()}`
    const functionName = `member_v2_test_gate_${suffix}`
    const triggerName = `member_v2_test_gate_${suffix}`
    let ddlReady = false
    let gate; let bootstrap; let writer
    try {
      for (const label of ['bootstrap', 'writer']) {
        if (sameMember && label === 'writer') { members.push(members[0]); continue }
        const member = await memberService.createMember({ tableName: fixture.tableName, member: { full_name: `Synthetic ${feed} ${label} ${suffix}`, current_level: 'JHS2' } })
        await memberService.syncNow()
        members.push(member)
      }
      const [bootstrapMember, writerMember] = members
      let attendanceBaseRevision = null
      if (feed === 'attendance') {
        attendanceService = await createMemberAttendanceService({ supabase: fixture.client, userId: ownerId, ownerId, storage: getRxStorageMemory(), online: () => true })
        await attendanceService.start()
        for (const member of members) {
          await attendanceService.saveAttendance({ memberId: member.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status: 'Present' })
          await attendanceService.syncNow()
        }
        const latest = await fixture.admin.from('member_v2_change_events').select('server_revision')
          .eq('owner_id', ownerId).eq('table_name', fixture.tableName).eq('member_id', writerMember.id)
          .eq('attendance_date', '2025-12-07').order('server_revision', { ascending: false }).limit(1).single()
        if (latest.error) throw latest.error
        attendanceBaseRevision = latest.data.server_revision
        const cleared = await fixture.admin.from('member_v2_change_events').delete()
          .eq('owner_id', ownerId).eq('table_name', fixture.tableName).eq('member_id', bootstrapMember.id)
          .eq('attendance_date', '2025-12-07')
        if (cleared.error) throw cleared.error
      } else {
        const cleared = await fixture.admin.from('member_v2_heads').delete()
          .eq('owner_id', ownerId).eq('table_name', fixture.tableName).eq('member_id', bootstrapMember.id)
        if (cleared.error) throw cleared.error
      }

      const latestOwnerEvent = await fixture.admin.from('member_v2_change_events').select('server_revision')
        .eq('owner_id', ownerId).order('server_revision', { ascending: false }).limit(1).single()
      if (latestOwnerEvent.error) throw latestOwnerEvent.error
      const afterRevision = latestOwnerEvent.data?.server_revision || 0
      const writerRevision = Number((await memberService.getMember(members[1].id))?.server_revision)
      if (!Number.isFinite(writerRevision) || writerRevision < 1) throw new Error('Synthetic profile writer has no confirmed base revision.')
      const gateSql = `create function public.${functionName}() returns trigger language plpgsql as $$ begin
        if new.member_id = '${bootstrapMember.id}'::uuid and new.operation_name = '${feed === 'profile' ? 'bootstrap' : 'attendance_bootstrap'}' then
          perform pg_advisory_xact_lock(hashtextextended('${gateKey}', 0));
        end if;
        return new;
      end; $$;
      create trigger ${triggerName} before insert on public.member_v2_change_events for each row execute function public.${functionName}();`
      const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
      await execFileAsync(docker, ['exec', '-i', readLocalSupabaseDbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', gateSql], { encoding: 'utf8' })
      ddlReady = true
      gate = psqlProcess(`datser-gate-${suffix}`)
      gate.send(`select pg_advisory_lock(hashtextextended('${gateKey}', 0));\n\\echo GATE_HELD`)
      await waitForPsql(gate, 'GATE_HELD')

      const setActor = `set local role authenticated; set local request.jwt.claim.sub = '${ownerId}';`
      bootstrap = psqlProcess(`datser-bootstrap-${suffix}`)
      const bootstrapRpc = feed === 'profile'
        ? `select public.pull_workspace_member_changes_v2('${ownerId}', null, 100);`
        : `select public.pull_member_v2_attendance_changes_v2('${ownerId}', null, 100);`
      bootstrap.send(`begin; ${setActor} ${bootstrapRpc} commit;\n\\echo BOOTSTRAP_DONE`)
      await waitForLockWait(`datser-bootstrap-${suffix}`, bootstrap)

      writer = psqlProcess(`datser-writer-${suffix}`)
      if (sameMember) {
        // Wait for the owner lock BEFORE reading the newly bootstrapped base;
        // then contend for the exact same head/cell, without fabricating a stale
        // revision. SQL helper access is confined to this privileged fixture.
        const table = fixture.tableName
        const memberId = writerMember.id
        const baseSql = feed === 'profile'
          ? `(select server_revision from public.member_v2_heads where owner_id='${ownerId}' and table_name='${table}' and member_id='${memberId}')`
          : `(select server_revision from public.member_v2_change_events where owner_id='${ownerId}' and table_name='${table}' and member_id='${memberId}' and attendance_date='2025-12-07' order by server_revision desc limit 1)`
        const writeSql = feed === 'profile'
          ? `select public.update_member_v2('${table}', '${ownerId}', '${memberId}', '{"Current Level":"JHS3"}'::jsonb, ${baseSql}, 'lock-order-${suffix}', public.member_v2_fingerprint('update_member_v2', '${ownerId}', '${table}', '${memberId}', ${baseSql}, '{"Current Level":"JHS3"}'::jsonb), '{}'::jsonb);`
          : `select public.save_member_v2_attendance('${ownerId}', '${memberId}', '${table}', '2025-12-07', 'Absent', null, ${baseSql}, 'lock-order-${suffix}', public.member_v2_attendance_fingerprint('set_member_v2_attendance', '${ownerId}', '${memberId}', '${table}', '2025-12-07', 'Absent', ${baseSql}));`
        writer.send(`begin; set local request.jwt.claim.sub = '${ownerId}'; select public.member_v2_lock_change_event_order('${ownerId}'); ${writeSql} commit;\n\\echo WRITER_DONE`)
      } else if (feed === 'profile') {
        const updates = { 'Current Level': 'JHS3' }
        const fingerprint = await createMemberV2Fingerprint({ operation: 'update_member_v2', ownerId, tableName: fixture.tableName, memberId: writerMember.id, baseServerRevision: writerRevision, payload: updates })
        writer.send(`begin; ${setActor} select public.update_member_v2('${fixture.tableName}', '${ownerId}', '${writerMember.id}', '${JSON.stringify(updates)}'::jsonb, ${writerRevision}, 'lock-order-${suffix}', '${fingerprint}', '{}'::jsonb); commit;\n\\echo WRITER_DONE`)
      } else {
        const status = 'Absent'
        const fingerprint = await createMemberV2AttendanceFingerprint({ operation: 'set_member_v2_attendance', ownerId, memberId: writerMember.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status, baseServerRevision: attendanceBaseRevision })
        writer.send(`begin; ${setActor} select public.save_member_v2_attendance('${ownerId}', '${writerMember.id}', '${fixture.tableName}', '2025-12-07', '${status}', null, ${attendanceBaseRevision}, 'lock-order-${suffix}', '${fingerprint}'); commit;\n\\echo WRITER_DONE`)
      }
      await waitForLockWait(`datser-writer-${suffix}`, writer)
      gate.send(`select pg_advisory_unlock(hashtextextended('${gateKey}', 0));\n\\echo GATE_RELEASED`)
      await waitForPsql(gate, 'GATE_RELEASED')
      await Promise.all([waitForPsql(bootstrap, 'BOOTSTRAP_DONE', 10000), waitForPsql(writer, 'WRITER_DONE', 10000)])
      await bootstrap.finish(); await writer.finish(); await gate.finish()

      const events = await fixture.admin.from('member_v2_change_events')
        .select('member_id,server_revision,operation_name,attendance_status,attendance_date,table_name')
        .eq('owner_id', ownerId).gt('server_revision', afterRevision).in('member_id', members.map((member) => member.id))
        .order('server_revision', { ascending: true })
      if (events.error) throw events.error
      const bootstrapEvent = events.data.find((row) => row.member_id === bootstrapMember.id && row.operation_name === (feed === 'profile' ? 'bootstrap' : 'attendance_bootstrap'))
      const writerEvent = events.data.find((row) => row.member_id === writerMember.id && row.operation_name === (feed === 'profile' ? 'update_member_v2' : 'set_member_v2_attendance'))
      expect(bootstrapEvent).toBeTruthy()
      expect(writerEvent).toBeTruthy()
      if (feed === 'attendance') expect(writerEvent).toMatchObject({ attendance_date: '2025-12-07', attendance_status: 'Absent', table_name: fixture.tableName })
      const pulled = feed === 'profile'
        ? await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: ownerId, p_after_server_revision: afterRevision, p_limit: 100 })
        : await fixture.client.rpc('pull_member_v2_attendance_changes_v2', { p_owner_id: ownerId, p_after_server_revision: afterRevision, p_limit: 100 })
      if (pulled.error) throw pulled.error
      const pulledIds = (pulled.data.changes || []).map((row) => row.member_id)
      expect(pulledIds).toEqual(expect.arrayContaining(members.map((member) => member.id)))
    } finally {
      try { gate?.send(`select pg_advisory_unlock(hashtextextended('${gateKey}', 0));`) } catch {}
      for (const session of [bootstrap, writer, gate]) {
        if (session && !session.child.killed && session.child.exitCode === null) { try { session.send('rollback;') } catch {}; session.child.stdin.end('\\q\n') }
      }
      await Promise.all([bootstrap, writer, gate].filter(Boolean).map((session) => session.child.exitCode === null ? new Promise((resolve) => session.child.once('close', resolve)) : Promise.resolve()))
      if (ddlReady) {
        const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
        await execFileAsync(docker, ['exec', '-i', readLocalSupabaseDbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `drop trigger if exists ${triggerName} on public.member_v2_change_events; drop function if exists public.${functionName}();`], { encoding: 'utf8' })
      }
      await attendanceService?.stop()
      await memberService.stop()
    }
  }

  it('serializes profile-feed revisions through transaction commit and leaves other workspaces independent', async () => {
    await assertCommitOrderedFeedPair('profile')
  }, 20000)

  it('serializes attendance-feed revisions through transaction commit', async () => {
    await assertCommitOrderedFeedPair('attendance')
  }, 20000)

  it('does not expose rolled-back revisions and still returns the next committed event', async () => {
    await assertCommitOrderedFeedPair('profile', true)
  }, 20000)

  it('completes profile bootstrap beside a same-workspace profile writer without lock inversion', async () => {
    await assertBootstrapWriterLockOrder('profile')
  }, 30000)

  it('completes attendance bootstrap beside a same-workspace attendance writer without lock inversion', async () => {
    await assertBootstrapWriterLockOrder('attendance')
  }, 30000)

  it.each(['profile', 'attendance'])('completes %s bootstrap beside a writer on the same member', async (feed) => {
    await assertBootstrapWriterLockOrder(feed, true)
  }, 30000)

  it('keeps unrelated month-table trigger capture active outside trusted delete RPCs', async () => {
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: getRxStorageMemory(), online: () => true })
    await service.start()
    try {
      const member = await service.createMember({ tableName: fixture.tableName, member: { full_name: 'Synthetic trigger capture', current_level: 'JHS2' } })
      await service.syncNow()
      await service.syncNow()
      expect((await service.getMember(member.id)).save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
      const before = await fixture.admin.from('member_v2_heads').select('server_revision')
        .eq('owner_id', fixture.userId).eq('table_name', fixture.tableName).eq('member_id', member.id).single()
      expect(before.error).toBeNull()

      const directUpdate = await fixture.admin.from(fixture.tableName).update({ 'Full Name': 'Synthetic trigger capture updated' }).eq('id', member.id).select('id')
      expect(directUpdate.error).toBeNull()
      expect(directUpdate.data).toHaveLength(1)

      const captured = await fixture.admin.from('member_v2_change_events')
        .select('server_revision, operation_name, request_id, is_deleted')
        .eq('owner_id', fixture.userId).eq('table_name', fixture.tableName).eq('member_id', member.id)
        .gt('server_revision', before.data.server_revision).order('server_revision', { ascending: true })
      expect(captured.error).toBeNull()
      expect(captured.data).toHaveLength(1)
      expect(captured.data[0]).toMatchObject({ operation_name: 'update', request_id: null, is_deleted: false })
    } finally {
      await service.stop()
    }
  }, 30000)

  it('wakes the real authenticated MemberService from an unfiltered local signal while RLS isolates other roles', async () => {
    const clientA = createClient(fixture.config.url, fixture.config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
    const clientB = createClient(fixture.config.url, fixture.config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
    const probeClient = createClient(fixture.config.url, fixture.config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
    const anonClient = createClient(fixture.config.url, fixture.config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
    let unrelatedClient = null
    let unrelatedUserId = null
    let service = null
    let initialServiceChannel = null
    let serviceCreation
    let disposed = false
    let cleanupPromise
    let pullCount = 0
    let originalRpc = null
    const rawRevisions = []
    const serviceSignalRevisions = []
    const anonRevisions = []
    const unrelatedRevisions = []
    const serviceStatuses = []
    const preflightStatuses = []
    const subscriptionStates = { raw: [], anon: [], unrelated: [] }
    const socketIdentities = new WeakMap()
    let nextSocketIdentity = 1
    const connectivityListeners = new Set()
    let connectivityOnline = true
    const connectivity = {
      isBackendReachable: () => connectivityOnline,
      subscribe: (listener) => { connectivityListeners.add(listener); return () => connectivityListeners.delete(listener) },
    }
    let originalChannel = null
    const removeChannelCalls = []
    let preflightChannel = null
    let registryAfterPreflight = null
    // Vitest timeouts race the test body; finally alone does not run before the next test.
    const cleanup = () => {
      disposed = true
      cleanupPromise ||= (async () => {
        if (serviceCreation) service = await serviceCreation
        await service?.stop()
        const clients = [clientA, clientB, probeClient, anonClient, unrelatedClient].filter(Boolean)
        await Promise.all(clients.map(async (client) => {
          await client.removeAllChannels()
          await client.auth.signOut()
          expect(client.getChannels()).toHaveLength(0)
          expect(client.realtime.isConnected()).toBe(false)
        }))
        if (originalRpc) clientB.rpc = originalRpc
        if (originalChannel) clientB.channel = originalChannel
        if (unrelatedUserId) {
          const removed = await fixture.admin.auth.admin.deleteUser(unrelatedUserId)
          expect(removed.error).toBeNull()
        }
        if (service) {
          expect(service.database.closed).toBe(true)
          expect(service.channel).toBeNull()
        }
        expect(connectivityListeners.size).toBe(0)
      })()
      return cleanupPromise
    }
    onTestFinished(cleanup)
    const requireActiveTest = () => { if (disposed) throw new Error('Realtime test has already finished.') }
    const makeProbe = (client, name, revisions, states) => {
      const channel = client.channel(name)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals' }, (payload) => {
          revisions.push(payload?.new?.latest_server_revision ?? null)
        })
        .subscribe((state) => states.push(state))
      return channel
    }
    const describeClientChannels = (client = clientB) => client.getChannels().map((channel) => ({
      topic: channel.topic,
      state: channel.state,
      postgresChangeIds: (channel.bindings.postgres_changes || []).map((binding) => binding.id).filter((id) => id !== undefined && id !== null).map(String),
    }))
    const channelBindingIds = (channel) => (channel?.bindings?.postgres_changes || []).map((binding) => binding.id).filter((id) => id !== undefined && id !== null).map(String)
    const describeSocket = (client) => {
      const socket = client.realtime.conn
      if (socket && !socketIdentities.has(socket)) socketIdentities.set(socket, `socket-${nextSocketIdentity++}`)
      return {
        identity: socket ? socketIdentities.get(socket) : null,
        readyState: socket?.readyState ?? null,
        connected: client.realtime.isConnected(),
        connecting: client.realtime.isConnecting(),
        disconnecting: client.realtime.isDisconnecting(),
      }
    }
    const waitUntilJoinedOrRejected = (states) => vi.waitFor(() => {
      expect(states.some((state) => ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state))).toBe(true)
    }, { timeout: 10000, interval: 50 })

    try {
      const [loginA, loginB] = await Promise.all([
        clientA.auth.signInWithPassword({ email: fixture.email, password: fixture.password }),
        clientB.auth.signInWithPassword({ email: fixture.email, password: fixture.password }),
      ])
      const probeLogin = await probeClient.auth.signInWithPassword({ email: fixture.email, password: fixture.password })
      expect(loginA.error).toBeNull(); expect(loginB.error).toBeNull(); expect(probeLogin.error).toBeNull()
      await Promise.all([
        clientA.realtime.setAuth(loginA.data.session.access_token),
        clientB.realtime.setAuth(loginB.data.session.access_token),
        probeClient.realtime.setAuth(probeLogin.data.session.access_token),
      ])
      const unrelatedEmail = `member-v2-unrelated-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@local.invalid`
      const unrelatedPassword = `Unrelated-${crypto.randomUUID()}-9a!`
      const unrelatedCreated = await fixture.admin.auth.admin.createUser({ email: unrelatedEmail, password: unrelatedPassword, email_confirm: true })
      expect(unrelatedCreated.error).toBeNull()
      unrelatedUserId = unrelatedCreated.data.user.id
      unrelatedClient = createClient(fixture.config.url, fixture.config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
      const unrelatedLogin = await unrelatedClient.auth.signInWithPassword({ email: unrelatedEmail, password: unrelatedPassword })
      expect(unrelatedLogin.error).toBeNull()
      await unrelatedClient.realtime.setAuth(unrelatedLogin.data.session.access_token)

      const memberId = crypto.randomUUID()
      const initialMember = {
        'Full Name': `Synthetic realtime ${memberId.slice(0, 8)}`,
        'Phone Number': '0555000000', Gender: 'Female', Age: '18', 'Current Level': 'SHS3',
      }
      const createFingerprint = await createMemberV2Fingerprint({
        operation: 'create_member_v2', ownerId: fixture.userId, tableName: fixture.tableName, memberId, payload: initialMember,
      })
      const created = await clientA.rpc('create_member_v2', {
        p_table_name: fixture.tableName, p_owner_id: fixture.userId, p_member_id: memberId,
        p_member: initialMember, p_request_id: crypto.randomUUID(), p_payload_fingerprint: createFingerprint,
      })
      expect(created.error).toBeNull()
      expect(created.data).toMatchObject({ status: 'SUCCESS', member_id: memberId })

      const bPull = clientB.rpc.bind(clientB)
      originalRpc = clientB.rpc
      clientB.rpc = (name, args, options) => {
        if (name === 'pull_workspace_member_changes_v2') pullCount += 1
        return bPull(name, args, options)
      }
      originalChannel = clientB.channel
      const bChannel = clientB.channel.bind(clientB)
      const originalRemoveChannel = clientB.removeChannel.bind(clientB)
      clientB.removeChannel = (channel) => {
        const call = { topic: channel?.topic || null, sameAsInitialServiceChannel: channel === initialServiceChannel, statusBefore: channel?.state || null, result: null }
        const promise = originalRemoveChannel(channel).then((result) => { call.result = result; return result })
        call.promise = promise
        removeChannelCalls.push(call)
        return promise
      }
      clientB.channel = (name, options) => {
        const channel = bChannel(name, options)
        if (name === `member-v2-signal:${fixture.userId}`) {
          const on = channel.on.bind(channel)
          channel.on = (type, filter, handler) => on(type, filter, (payload, ...args) => {
            if (type === 'postgres_changes' && filter?.table === 'member_v2_realtime_signals') {
              serviceSignalRevisions.push(payload?.new?.latest_server_revision ?? null)
            }
            handler?.(payload, ...args)
          })
          const subscribe = channel.subscribe.bind(channel)
          channel.subscribe = (callback, timeout) => subscribe((status, error) => {
            serviceStatuses.push({ status, errorName: error?.name || null, errorMessage: error ? safeRealtimeError(error) : null })
            callback?.(status, error)
          }, timeout)
        }
        return channel
      }
      preflightChannel = probeClient.channel(`member-v2-direct-preflight:${fixture.userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_v2_realtime_signals' }, (payload) => rawRevisions.push(payload?.new?.latest_server_revision ?? null))
        .subscribe((status, error) => preflightStatuses.push({ status, errorMessage: error ? safeRealtimeError(error) : null }))
      await vi.waitFor(() => expect(preflightStatuses.some((item) => ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(item.status))).toBe(true), { timeout: 10000, interval: 50 })
      expect(preflightStatuses).toContainEqual(expect.objectContaining({ status: 'SUBSCRIBED' }))
      const preflightBindingIds = channelBindingIds(preflightChannel)
      expect(preflightBindingIds).toHaveLength(1)
      await vi.waitFor(async () => {
        registryAfterPreflight = await inspectLocalSignalRealtime(fixture.userId)
        expect(registryAfterPreflight.subscriptions).toHaveLength(1)
      }, { timeout: 5000, interval: 100 })
      expect(registryAfterPreflight.rlsEnabled).toBe(true)
      expect(registryAfterPreflight.subscriptions).toHaveLength(1)
      expect(registryAfterPreflight.subscriptions[0]).toMatchObject({ event: 'INSERT', role: 'authenticated', filters: '{}' })
      const rawServerSubscriptionId = registryAfterPreflight.subscriptions[0].subscriptionId
      requireActiveTest()
      serviceCreation = createMemberService({
        supabase: clientB, userId: fixture.userId, ownerId: fixture.userId,
        storage: getRxStorageMemory(), online: () => true, connectivity, realtimeDebounceMs: 0,
      })
      service = await serviceCreation
      requireActiveTest()
      await service.start()
      await service.syncNow()
      initialServiceChannel = service.channel
      await vi.waitFor(() => expect(serviceStatuses.some((item) => ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(item.status))).toBe(true), { timeout: 10000, interval: 50 })
      expect(serviceStatuses).toContainEqual(expect.objectContaining({ status: 'SUBSCRIBED' }))
      await vi.waitFor(() => expect(service.channel?.state).toBe('joined'), { timeout: 10000, interval: 50 })
      const initialServiceBindingIds = channelBindingIds(service.channel)
      expect(initialServiceBindingIds).toHaveLength(1)
      await vi.waitFor(async () => {
        const currentRegistry = await inspectLocalSignalRealtime(fixture.userId)
        expect(currentRegistry.subscriptions).toHaveLength(2)
      }, { timeout: 5000, interval: 100 })
      const registryAtServiceJoin = await inspectLocalSignalRealtime(fixture.userId)
      expect(registryAtServiceJoin.rlsEnabled).toBe(true)
      expect(registryAtServiceJoin.subscriptions).toHaveLength(2)
      expect(registryAtServiceJoin.subscriptions.length).toBe(registryAfterPreflight.subscriptions.length + 1)
      expect(registryAtServiceJoin.subscriptions.every((row) => row.event === 'INSERT' && row.role === 'authenticated')).toBe(true)
      expect(registryAtServiceJoin.subscriptions.every((row) => /member_v2_realtime_signals$/.test(row.entity) && row.filters === '{}')).toBe(true)
      const channelsBeforeDisconnect = describeClientChannels()
      const probeChannelsBeforeDisconnect = describeClientChannels(probeClient)
      expect(channelsBeforeDisconnect).toHaveLength(1)
      expect(probeChannelsBeforeDisconnect).toHaveLength(1)
      expect(channelsBeforeDisconnect.every((channel) => channel.state === 'joined' && channel.postgresChangeIds.length === 1)).toBe(true)
      const initialServiceRegistration = registryAtServiceJoin.subscriptions.find((row) => row.subscriptionId !== rawServerSubscriptionId)
      expect(initialServiceRegistration).toBeDefined()
      const registryIdsBeforeDisconnect = registryAtServiceJoin.subscriptions.map((row) => row.subscriptionId)

      const anonChannel = makeProbe(anonClient, `member-v2-anon-probe:${memberId}`, anonRevisions, subscriptionStates.anon)
      const unrelatedChannel = makeProbe(unrelatedClient, `member-v2-unrelated-probe:${memberId}`, unrelatedRevisions, subscriptionStates.unrelated)
      await Promise.all([
        waitUntilJoinedOrRejected(subscriptionStates.anon),
        waitUntilJoinedOrRejected(subscriptionStates.unrelated),
      ])
      const rlsAfterProbes = await inspectLocalSignalRealtime(fixture.userId)
      expect(rlsAfterProbes.rlsEnabled).toBe(true)
      expect(rlsAfterProbes.subscriptions.length).toBeGreaterThanOrEqual(2)
      expect(rlsAfterProbes.subscriptions.every((row) => row.filters === '{}' && row.event === 'INSERT')).toBe(true)

      const baseline = await service.getMember(memberId)
      expect(baseline?.server_revision).toBe(created.data.server_revision)
      const pullsBeforeEdit = pullCount
      const updates = { 'Full Name': `Synthetic edited ${memberId.slice(0, 8)}` }
      const updateFingerprint = await createMemberV2Fingerprint({
        operation: 'update_member_v2', ownerId: fixture.userId, tableName: fixture.tableName,
        memberId, baseServerRevision: baseline.server_revision, payload: updates,
      })
      const updated = await clientA.rpc('update_member_v2', {
        p_table_name: fixture.tableName, p_owner_id: fixture.userId, p_member_id: memberId,
        p_updates: updates, p_base_server_revision: baseline.server_revision,
        p_request_id: crypto.randomUUID(), p_payload_fingerprint: updateFingerprint, p_identity: {},
      })
      expect(updated.error).toBeNull()
      expect(updated.data.status).toBe('SUCCESS')
      const revision = Number(updated.data.server_revision)
      const bSignalRead = await clientB.from('member_v2_realtime_signals')
        .select('signal_id,owner_id,latest_server_revision')
        .eq('owner_id', fixture.userId).eq('latest_server_revision', revision).maybeSingle()
      expect(bSignalRead.error).toBeNull()
      expect(bSignalRead.data).toMatchObject({ owner_id: fixture.userId, latest_server_revision: revision })

      await vi.waitFor(() => expect(rawRevisions).toContain(revision), { timeout: 10000, interval: 50 })
      await vi.waitFor(() => expect(serviceSignalRevisions).toContain(revision), { timeout: 10000, interval: 50 })
      await vi.waitFor(() => expect(pullCount).toBeGreaterThan(pullsBeforeEdit), { timeout: 10000, interval: 50 })
      await vi.waitFor(async () => expect((await service.getMember(memberId))?.server_revision).toBe(revision), { timeout: 10000, interval: 50 })

      const anonRead = await anonClient.from('member_v2_realtime_signals').select('signal_id')
        .eq('owner_id', fixture.userId).eq('latest_server_revision', revision).maybeSingle()
      const unrelatedRead = await unrelatedClient.from('member_v2_realtime_signals').select('signal_id')
        .eq('owner_id', fixture.userId).eq('latest_server_revision', revision).maybeSingle()
      expect(Boolean(anonRead.error) || anonRead.data === null).toBe(true)
      expect(Boolean(unrelatedRead.error) || unrelatedRead.data === null).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(anonRevisions).not.toContain(revision)
      expect(unrelatedRevisions).not.toContain(revision)
      expect(rawRevisions.filter((value) => Number(value) === revision)).toHaveLength(1)
      expect(serviceSignalRevisions.filter((value) => Number(value) === revision)).toHaveLength(1)
      expect(pullCount - pullsBeforeEdit).toBe(1)
      const initialEditPullCount = pullCount - pullsBeforeEdit

      const firstEventCount = rawRevisions.length
      const disconnectAt = Date.now()
      const memberSocketBeforeDisconnect = describeSocket(clientB)
      const probeSocketBeforeDisconnect = describeSocket(probeClient)
      connectivityOnline = false
      connectivityListeners.forEach((listener) => listener('OFFLINE'))
      await vi.waitFor(() => expect(service.channel).toBeNull(), { timeout: 10000, interval: 50 })
      await vi.waitFor(() => expect(serviceStatuses.some((item) => item.status === 'CLOSED')).toBe(true), { timeout: 10000, interval: 50 })
      const channelsOffline = describeClientChannels()
      expect(channelsOffline).toHaveLength(0)
      expect(initialServiceChannel.state).toBe('closed')
      await vi.waitFor(() => expect(removeChannelCalls.some((call) => call.topic === initialServiceChannel.topic && call.promise)).toBe(true), { timeout: 10000, interval: 50 })
      await removeChannelCalls.find((call) => call.topic === initialServiceChannel.topic)?.promise
      const initialServiceRemoveCall = removeChannelCalls.find((call) => call.topic === initialServiceChannel.topic)
      expect(initialServiceRemoveCall?.sameAsInitialServiceChannel).toBe(true)
      expect(initialServiceRemoveCall?.result).toBe('ok')
      expect(clientB.realtime.isConnected()).toBe(false)
      expect(probeClient.realtime.isConnected()).toBe(true)
      const memberSocketOffline = describeSocket(clientB)
      const probeSocketOffline = describeSocket(probeClient)
      console.info('MEMBER_V2_OFFLINE_SOCKET_STATE_ID_ONLY', JSON.stringify({ memberSocketOffline, probeSocketOffline, oldChannelState: initialServiceChannel.state, removeChannelResult: initialServiceRemoveCall?.result }))
      const registryOffline = await inspectLocalSignalRealtime(fixture.userId)
      const oldServiceSubscriptionIds = [initialServiceRegistration.subscriptionId]
      connectivityOnline = true
      connectivityListeners.forEach((listener) => listener('ONLINE'))
      await vi.waitFor(() => expect(serviceStatuses.length).toBeGreaterThanOrEqual(3), { timeout: 10000, interval: 50 })
      console.info('MEMBER_V2_RECONNECT_STATUS_ID_ONLY', JSON.stringify({
        serviceStatuses,
        serviceChannelState: service.channel?.state,
        memberSocket: describeSocket(clientB),
        probeSocket: describeSocket(probeClient),
        removeChannelResult: initialServiceRemoveCall?.result,
      }))
      expect(serviceStatuses.at(-1).status).toBe('SUBSCRIBED')
      await vi.waitFor(() => expect(service.channel?.state).toBe('joined'), { timeout: 10000, interval: 50 })
      const channelsAfterReconnect = describeClientChannels()
      const probeChannelsAfterReconnect = describeClientChannels(probeClient)
      const memberSocketAfterReconnect = describeSocket(clientB)
      const probeSocketAfterReconnect = describeSocket(probeClient)
      expect(channelsAfterReconnect).toHaveLength(1)
      expect(probeChannelsAfterReconnect).toHaveLength(1)
      expect(service.channel).not.toBe(initialServiceChannel)
      expect(memberSocketAfterReconnect.identity).not.toBe(memberSocketBeforeDisconnect.identity)
      expect(memberSocketAfterReconnect.connected).toBe(true)
      expect(probeSocketAfterReconnect.identity).toBe(probeSocketBeforeDisconnect.identity)
      expect(channelsAfterReconnect.every((channel) => channel.state === 'joined' && channel.postgresChangeIds.length === 1)).toBe(true)
      let registryAtReconnect = null
      let newServerSubscriptionRows = []
      await vi.waitFor(async () => {
        registryAtReconnect = await inspectLocalSignalRealtime(fixture.userId)
        newServerSubscriptionRows = registryAtReconnect.subscriptions.filter((row) => !registryIdsBeforeDisconnect.includes(row.subscriptionId))
        expect(newServerSubscriptionRows).toHaveLength(1)
      }, { timeout: 5000, interval: 100 })
      expect(newServerSubscriptionRows).toHaveLength(1)
      const expectedLiveServerIds = new Set([rawServerSubscriptionId, newServerSubscriptionRows[0].subscriptionId])
      const liveRegistryRows = registryAtReconnect.subscriptions.filter((row) => expectedLiveServerIds.has(row.subscriptionId))
      const unboundRegistryRowsAtReconnect = registryAtReconnect.subscriptions.filter((row) => !expectedLiveServerIds.has(row.subscriptionId))
      expect(liveRegistryRows).toHaveLength(2)
      expect(registryAtReconnect.subscriptions.every((row) => row.event === 'INSERT' && row.role === 'authenticated' && row.filters === '{}')).toBe(true)
      const registryImmediatelyBeforeEvent = await inspectLocalSignalRealtime(fixture.userId)
      const oldRowPresentAtEvent = registryImmediatelyBeforeEvent.subscriptions.some((row) => oldServiceSubscriptionIds.includes(row.subscriptionId))
      const pullsBeforeReconnectEdit = pullCount

      const reconnectBaseline = await service.getMember(memberId)
      expect(reconnectBaseline?.server_revision).toBe(revision)
      const reconnectUpdates = { 'Full Name': `Synthetic reconnect ${memberId.slice(0, 8)}` }
      const reconnectFingerprint = await createMemberV2Fingerprint({
        operation: 'update_member_v2', ownerId: fixture.userId, tableName: fixture.tableName,
        memberId, baseServerRevision: reconnectBaseline.server_revision, payload: reconnectUpdates,
      })
      const reconnectUpdated = await clientA.rpc('update_member_v2', {
        p_table_name: fixture.tableName, p_owner_id: fixture.userId, p_member_id: memberId,
        p_updates: reconnectUpdates, p_base_server_revision: reconnectBaseline.server_revision,
        p_request_id: crypto.randomUUID(), p_payload_fingerprint: reconnectFingerprint, p_identity: {},
      })
      expect(reconnectUpdated.error).toBeNull()
      expect(reconnectUpdated.data.status).toBe('SUCCESS')
      const reconnectRevision = Number(reconnectUpdated.data.server_revision)
      await vi.waitFor(() => expect(rawRevisions).toContain(reconnectRevision), { timeout: 10000, interval: 50 })
      await vi.waitFor(() => expect(serviceSignalRevisions).toContain(reconnectRevision), { timeout: 10000, interval: 50 })
      await vi.waitFor(() => expect(pullCount).toBe(pullsBeforeReconnectEdit + 1), { timeout: 10000, interval: 50 })
      await vi.waitFor(async () => expect((await service.getMember(memberId))?.server_revision).toBe(reconnectRevision), { timeout: 10000, interval: 50 })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(rawRevisions.filter((value) => Number(value) === reconnectRevision)).toHaveLength(1)
      expect(serviceSignalRevisions.filter((value) => Number(value) === reconnectRevision)).toHaveLength(1)
      expect(pullCount - pullsBeforeReconnectEdit).toBe(1)
      const registryAfterSignal = await inspectLocalSignalRealtime(fixture.userId)
      let registryAfterObservation = registryAfterSignal
      let cleanupLatencyMs = registryAfterSignal.subscriptions.some((row) => oldServiceSubscriptionIds.includes(row.subscriptionId))
        ? null
        : Date.now() - disconnectAt
      while (cleanupLatencyMs === null && Date.now() - disconnectAt < 10000) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        registryAfterObservation = await inspectLocalSignalRealtime(fixture.userId)
        if (!registryAfterObservation.subscriptions.some((row) => oldServiceSubscriptionIds.includes(row.subscriptionId))) {
          cleanupLatencyMs = Date.now() - disconnectAt
        }
      }
      const unboundRegistryRowsAfterObservation = registryAfterObservation.subscriptions.filter((row) => !expectedLiveServerIds.has(row.subscriptionId))

      console.info('MEMBER_V2_DIRECT_REALTIME_WAKE_ID_ONLY', JSON.stringify({
        ownerId: fixture.userId, memberId, baseRevision: baseline.server_revision, revision,
        serviceStatuses, preflightStatuses, unauthorizedStatuses: { anonymous: subscriptionStates.anon, unrelated: subscriptionStates.unrelated },
        serviceChannelState: service.channel?.state,
        serviceRegistryRows: registryAtServiceJoin.subscriptions.length,
        emptyFilters: registryAtServiceJoin.subscriptions[0].filters,
        channelsBeforeDisconnect,
        registryIdsBeforeDisconnect,
        disconnectAt,
        channelsOffline,
        memberSocketBeforeDisconnect,
        memberSocketOffline,
        memberSocketAfterReconnect,
        probeSocketBeforeDisconnect,
        probeSocketOffline,
        probeSocketAfterReconnect,
        initialServiceChannelClosed: initialServiceChannel.state === 'closed',
        removeChannelCalledForInitialServiceChannel: initialServiceRemoveCall?.sameAsInitialServiceChannel === true,
        removeChannelResult: initialServiceRemoveCall?.result,
        registryOffline: registryOffline.subscriptions,
        oldServiceSubscriptionIds,
        rawServerSubscriptionId,
        initialServiceRegistration,
        channelsAfterReconnect,
        registryAtReconnect: registryAtReconnect.subscriptions,
        registryImmediatelyBeforeEvent: registryImmediatelyBeforeEvent.subscriptions,
        oldRowPresentAtEvent,
        registryAfterSignal: registryAfterSignal.subscriptions,
        registryAfterObservation: registryAfterObservation.subscriptions,
        newServerSubscriptionRows,
        unboundRegistryRowsAtReconnect,
        unboundRegistryRowsAfterObservation,
        cleanupLatencyMs,
        rawCallback: rawRevisions.includes(revision),
        serviceCallbackCount: serviceSignalRevisions.filter((value) => Number(value) === revision).length,
        authoritativePullCount: initialEditPullCount,
        convergedRevision: (await service.getMember(memberId))?.server_revision,
        anonymousReadDenied: Boolean(anonRead.error) || anonRead.data === null,
        unrelatedReadDenied: Boolean(unrelatedRead.error) || unrelatedRead.data === null,
        anonymousEventIgnored: !anonRevisions.includes(revision),
        unrelatedEventIgnored: !unrelatedRevisions.includes(revision),
        reconnectRegistryRows: registryAfterObservation.subscriptions.length,
        reconnectRawCallback: rawRevisions.length > firstEventCount,
        reconnectRevision,
        reconnectServiceCallbackCount: serviceSignalRevisions.filter((value) => Number(value) === reconnectRevision).length,
        reconnectPullCount: pullCount - pullsBeforeReconnectEdit,
        reconnectConvergedRevision: (await service.getMember(memberId))?.server_revision,
      }))
    } finally {
      await cleanup()
    }
  }, 30000)

  it('recovers an authenticated realistic local create after the harness selected an unregistered source month', async () => {
    let online = false
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    onTestFinished(() => service.stop())
    await service.start()
    const local = await service.createMember({ tableName: 'January_2025', member: { full_name: 'Recovered authenticated member', phone_number: '0240000000', age: '12', gender: 'Male', current_level: 'JHS3', notes: 'Synthetic recovery test' } })
    const request = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].toJSON()
    online = true; await service.syncNow()
    expect((await service.getMember(local.id)).save_state).toBe(MEMBER_SAVE_STATES.FAILED_RETRYABLE)
    expect((await service.getMember(local.id)).last_error).toBe('This logical month is not registered for the workspace')
    expect((await service.listTrustedSourceTables()).map((month) => month.table_name)).toContain(fixture.tableName)

    const recovered = await service.recoverUnregisteredTargetCreates({ tableName: fixture.tableName })
    expect(recovered).toEqual({ recovered: 1, requestIds: [request.id] })
    await service.syncNow()
    const confirmed = await service.getMember(local.id)
    expect(confirmed).toMatchObject({ member_id: local.id, table_name: fixture.tableName, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    expect(confirmed.data.member_code).toBeTruthy()
    expect(await service.awaitServerConfirmation(request.id)).toMatchObject({ state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    const serverRow = await fixture.client.from(fixture.tableName).select('id').eq('id', local.id)
    expect(serverRow.error).toBeNull(); expect(serverRow.data).toHaveLength(1)
    await service.stop()
  }, 30000)

  it('uses authenticated source capabilities to recover a realistic profile without duplicate server rows', async () => {
    let online = false
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await service.start()
    const capabilities = await service.getSourceTableCapabilities(fixture.tableName)
    expect(capabilities.fields).toEqual(expect.any(Set)); expect(capabilities.fields.has('Full Name')).toBe(true); expect(capabilities.fields.has('date_of_birth')).toBe(false)
    const local = await service.createMember({ tableName: fixture.tableName, member: { full_name: 'Compatible server profile', phone_number: '0240000000', age: '15', gender: 'Female', current_level: 'SHS1', parent_name_1: 'Synthetic parent', notes: 'Synthetic note', date_of_birth: '2011-01-01' } })
    const request = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].toJSON()
    online = true; await service.syncNow()
    expect((await service.getMember(local.id)).last_error).toBe('Unsupported member field')
    const repaired = await service.recoverUnsupportedFieldCreates({ fields: capabilities.fields })
    expect(repaired).toMatchObject({ recovered: 1, requestIds: [request.id], removedFields: ['date_of_birth'] })
    await service.syncNow()
    const confirmed = await service.getMember(local.id)
    expect(confirmed).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, table_name: fixture.tableName })
    expect(confirmed.data).toMatchObject({ 'Full Name': 'Compatible server profile', 'Phone Number': 240000000, Age: 15, Gender: 'Female', 'Current Level': 'SHS1', parent_name_1: 'Synthetic parent', notes: 'Synthetic note' })
    expect(confirmed.data.member_code).toBeTruthy(); expect(confirmed.data.date_of_birth).toBeUndefined()
    const serverRow = await fixture.client.from(fixture.tableName).select('id').eq('id', local.id)
    expect(serverRow.error).toBeNull(); expect(serverRow.data).toHaveLength(1)
    await service.stop()
  }, 30000)

  it('persists offline work, confirms the same request, and retains a real server conflict', async () => {
    let online = false
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await service.start()
    const local = await service.createMember({ tableName: fixture.tableName, member: { full_name: 'Offline synthetic member', phone_number: '0240000000' } })
    const request = (await service.database.mutations.find({ selector: { member_id: local.id } }).exec())[0].id
    expect((await service.getMember(local.id)).save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING)
    await service.stop()

    const reopened = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await reopened.start()
    expect((await reopened.getMember(local.id)).data['Full Name']).toBe('Offline synthetic member')
    online = true; await reopened.syncNow()
    const confirmed = await reopened.getMember(local.id)
    expect(confirmed.last_error).toBeNull()
    expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    expect(confirmed.data.member_code).toBeTruthy()
    expect(await reopened.awaitServerConfirmation(request)).toMatchObject({ state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })

    const originalCode = confirmed.data.member_code
    await reopened.updateMember(local.id, { full_name: 'Edited full profile', phone_number: '0555000000', age: '19', gender: 'Female', current_level: 'Completed SHS' })
    await reopened.syncNow()
    const edited = await reopened.getMember(local.id)
    expect(edited).toMatchObject({ id: local.id, member_id: local.id, table_name: fixture.tableName, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    expect(edited.data).toMatchObject({ 'Full Name': 'Edited full profile', 'Phone Number': 555000000, Age: 19, Gender: 'Female', 'Current Level': 'Completed SHS', member_code: originalCode })

    online = false; await reopened.updateMember(local.id, { full_name: 'Local offline edit' })
    const remotePayload = { 'Full Name': 'Remote concurrent edit' }
    const fingerprint = await createMemberV2Fingerprint({ operation: 'update_member_v2', ownerId: fixture.userId, tableName: fixture.tableName, memberId: local.id, baseServerRevision: edited.server_revision, payload: remotePayload })
    const remote = await fixture.client.rpc('update_member_v2', { p_table_name: fixture.tableName, p_owner_id: fixture.userId, p_member_id: local.id, p_updates: remotePayload, p_base_server_revision: edited.server_revision, p_request_id: crypto.randomUUID(), p_payload_fingerprint: fingerprint, p_identity: {} })
    expect(remote.error).toBeNull()
    const signals = await fixture.client.from('member_v2_realtime_signals').select('latest_server_revision').eq('owner_id', fixture.userId)
    expect(signals.error).toBeNull()
    expect(signals.data.some((signal) => signal.latest_server_revision === remote.data.server_revision)).toBe(true)
    online = true; await reopened.syncNow()
    const conflict = await reopened.getMember(local.id)
    expect(conflict.save_state).toBe(MEMBER_SAVE_STATES.CONFLICT)
    expect(conflict.data['Full Name']).toBe('Local offline edit')
    await reopened.stop()
  }, 30000)

  it('persists an offline Member V2 delete, then soft-deletes only through the trusted RPC', async () => {
    let online = false
    const service = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    await service.start()
    const created = await service.createMember({ tableName: fixture.tableName, member: { full_name: 'Trusted soft delete', current_level: 'JHS2' } })
    online = true; await service.syncNow()
    const confirmed = await service.getMember(created.id)
    expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)

    online = false
    await service.deleteMember(created.id)
    const deletion = (await service.database.mutations.find({ selector: { member_id: created.id } }).exec())[0].toJSON()
    expect(deletion.operation).toBe('delete_member_v2')
    expect((await fixture.client.from(fixture.tableName).select('deleted_at').eq('id', created.id).single()).data.deleted_at).toBeNull()

    online = true; await service.syncNow()
    const local = await service.getMember(created.id)
    expect(local).toMatchObject({ is_deleted: true, save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    const row = await fixture.client.from(fixture.tableName).select('id, deleted_at').eq('id', created.id).single()
    expect(row.error).toBeNull(); expect(row.data.deleted_at).toBeTruthy()
    const changes = await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: fixture.userId, p_after_server_revision: confirmed.server_revision, p_limit: 10 })
    expect(changes.error).toBeNull()
    const deleteChanges = changes.data.changes.filter((change) => change.member_id === created.id)
    expect(deleteChanges).toHaveLength(1)
    expect(deleteChanges[0]).toMatchObject({ is_deleted: true })
    await service.stop()
  }, 30000)

  it('persists isolated Sunday attendance offline, then confirms it through the trusted local RPC', async () => {
    let online = false
    const memberService = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    onTestFinished(() => memberService.stop())
    await memberService.start()
    const member = await memberService.createMember({ tableName: fixture.tableName, member: { full_name: 'Attendance synthetic member', phone_number: '0240000000', age: '18', gender: 'Female', current_level: 'SHS3' } })
    online = true; await memberService.syncNow()
    const confirmed = await memberService.getMember(member.id)
    expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)

    online = false
    const attendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    onTestFinished(() => attendance.stop())
    await attendance.start()
    await attendance.saveAttendance({ memberId: confirmed.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status: 'Present' })
    await attendance.saveAttendance({ memberId: confirmed.id, tableName: fixture.tableName, attendanceDate: '2025-12-14', status: 'Absent' })
    expect(await attendance.getForMember(confirmed.id)).toHaveLength(2)
    await attendance.stop()

    const reopened = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage, online: () => online })
    onTestFinished(() => reopened.stop())
    await reopened.start()
    expect((await reopened.getForMember(confirmed.id)).map((row) => row.status)).toEqual(['Present', 'Absent'])
    online = true; await reopened.syncNow()
    const attendanceSync = await reopened.getSyncState()
    const attendanceMutations = (await reopened.database.mutations.find({ selector: { member_id: confirmed.id } }).exec()).map((mutation) => mutation.toJSON())
    expect(attendanceSync.state, JSON.stringify({ state: attendanceSync.state, lastError: attendanceSync.lastError, mutations: attendanceMutations.map(({ id, save_state, last_error }) => ({ id, save_state, last_error })) })).toBe('SYNCED')
    await reopened.saveAttendance({ memberId: confirmed.id, tableName: fixture.tableName, attendanceDate: '2025-12-07', status: null })
    await reopened.syncNow()
    expect((await reopened.getForMember(confirmed.id)).map((row) => row.status)).toEqual(['Absent'])
    await reopened.stop(); await memberService.stop()
  }, 30000)

  it('propagates confirmed profile and isolated attendance to a second local client', async () => {
    const firstStorage = getRxStorageMemory(); const secondStorage = getRxStorageMemory()
    const first = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, online: () => true })
    await first.start(); const created = await first.createMember({ tableName: fixture.tableName, member: { full_name: 'Second client synthetic member', gender: 'Male', current_level: 'JHS3' } }); await first.syncNow()
    const firstAttendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, online: () => true })
    await firstAttendance.start(); await firstAttendance.saveAttendance({ memberId: created.id, tableName: fixture.tableName, attendanceDate: '2025-12-21', status: 'Present' }); await firstAttendance.syncNow()
    await Promise.all([first.stop(), firstAttendance.stop()])
    const second = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: secondStorage, online: () => true })
    await second.start(); await second.pull()
    expect((await second.getMember(created.id)).data['Full Name']).toBe('Second client synthetic member')

    const secondAttendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: secondStorage, online: () => true })
    await secondAttendance.start(); await secondAttendance.pull()
    expect((await secondAttendance.getForMember(created.id))[0]).toMatchObject({ attendance_date: '2025-12-21', status: 'Present' })
    await Promise.all([second.stop(), secondAttendance.stop()])
  }, 30000)

  it('keeps simulated-offline member and attendance work off the local server until reconnect, then confirms without duplicates', async () => {
    const controllerStorage = new Map(); const connectivity = createMemberV2NetworkController({ storage: { getItem: (key) => controllerStorage.get(key) || null, setItem: (key, value) => controllerStorage.set(key, value), removeItem: (key) => controllerStorage.delete(key) }, browserOnlineCheck: () => true })
    const firstStorage = getRxStorageMemory()
    const first = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); await first.start()
    const created = await first.createMember({ tableName: fixture.tableName, member: { full_name: 'Offline boundary original', current_level: 'JHS2' } }); await first.syncNow(); await first.syncNow()
    const confirmed = await first.getMember(created.id); expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)
    const firstAttendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); await firstAttendance.start(); await new Promise((resolve) => setTimeout(resolve, 25))
    connectivity.setSimulatedOffline(true)
    const updated = await first.updateMember(created.id, { full_name: 'Offline boundary local edit' }); const attendanceSave = await firstAttendance.saveAttendance({ memberId: created.id, tableName: fixture.tableName, attendanceDate: '2025-12-28', status: 'Present' })
    expect(updated.save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING); expect((await firstAttendance.getForMember(created.id))[0].save_state).toBe(MEMBER_SAVE_STATES.LOCAL_PENDING)

    await Promise.all([first.stop(), firstAttendance.stop()])
    const serverBefore = await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: fixture.userId, p_after_server_revision: 0, p_limit: 100 }); expect(serverBefore.error).toBeNull(); expect(serverBefore.data.changes.find((change) => change.member_id === created.id).member['Full Name']).toBe('Offline boundary original')

    const firstReopened = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); const attendanceReopened = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, connectivity }); await Promise.all([firstReopened.start(), attendanceReopened.start()]); const memberMutation = (await firstReopened.database.mutations.find({ selector: { member_id: created.id } }).exec())[0].toJSON(); connectivity.setSimulatedOffline(false); await Promise.all([firstReopened.syncNow(), attendanceReopened.syncNow()]); await Promise.all([firstReopened.syncNow(), attendanceReopened.syncNow()])
    const firstConfirmed = await firstReopened.getMember(created.id); expect(firstConfirmed).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, data: { 'Full Name': 'Offline boundary local edit' } }); expect((await attendanceReopened.getForMember(created.id))[0].save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED); await Promise.all([firstReopened.stop(), attendanceReopened.stop()])
    const row = await fixture.client.from(fixture.tableName).select('id').eq('id', created.id); expect(row.data).toHaveLength(1)
    expect(memberMutation.id).toMatch(/^update_member_v2:/); expect(attendanceSave.requestId).toMatch(/^member_v2_attendance:/)
  }, 30000)

  it('rebases repeated offline profile and same-Sunday attendance edits in order without artificial conflicts', async () => {
    let online = false; const localStorage = getRxStorageMemory()
    const members = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: localStorage, online: () => online })
    await members.start()
    const created = await members.createMember({ tableName: fixture.tableName, member: { full_name: 'Rebase original', current_level: 'JHS2' } })
    online = true; await members.syncNow()
    const confirmed = await members.getMember(created.id)
    expect(confirmed.save_state).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)

    online = false
    await members.updateMember(created.id, { full_name: 'Rebase first local edit' })
    await members.updateMember(created.id, { full_name: 'Rebase second local edit' })
    const attendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: localStorage, online: () => online })
    await attendance.start()
    await attendance.saveAttendance({ memberId: created.id, tableName: fixture.tableName, attendanceDate: '2025-12-28', status: 'Present' })
    await attendance.saveAttendance({ memberId: created.id, tableName: fixture.tableName, attendanceDate: '2025-12-28', status: 'Absent' })

    online = true
    await Promise.all([members.syncNow(), attendance.syncNow()])
    await Promise.all([members.syncNow(), attendance.syncNow()])
    expect((await members.getMember(created.id))).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, data: { 'Full Name': 'Rebase second local edit' } })
    expect((await attendance.getForMember(created.id))[0]).toMatchObject({ save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, status: 'Absent', attendance_date: '2025-12-28' })

    const memberChanges = await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: fixture.userId, p_after_server_revision: 0, p_limit: 100 })
    const attendanceChanges = await fixture.client.rpc('pull_member_v2_attendance_changes_v2', { p_owner_id: fixture.userId, p_after_server_revision: 0, p_limit: 100 })
    expect(memberChanges.error).toBeNull(); expect(attendanceChanges.error).toBeNull()
    expect(memberChanges.data.changes.filter((change) => change.member_id === created.id)).toHaveLength(3)
    expect(attendanceChanges.data.changes.filter((change) => change.member_id === created.id && change.attendance_date === '2025-12-28')).toHaveLength(2)
    const memberQueue = (await members.database.mutations.find({ selector: { member_id: created.id } }).exec()).map((record) => record.toJSON())
    const attendanceQueue = (await attendance.database.mutations.find({ selector: { member_id: created.id, attendance_date: '2025-12-28' } }).exec()).map((record) => record.toJSON())
    expect(memberQueue).toEqual([])
    expect(attendanceQueue).toEqual([])
    await Promise.all([members.stop(), attendance.stop()])
  }, 30000)

  it('stores V2 attendance in the monthly row and captures a Quick Sunday write into the same pull feed', async () => {
    const activeServices = []
    try {
    const members = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: getRxStorageMemory(), online: () => true })
    activeServices.push(members)
    await members.start()
    await members.syncNow()
    const created = await members.createMember({ tableName: fixture.tableName, member: { full_name: 'Synthetic attendance interoperability' } })
    const mutation = (await members.database.mutations.find({ selector: { member_id: created.id } }).exec())[0].toJSON()
    await members.syncNow()
    await members.syncNow()
    const confirmed = await members.awaitServerConfirmation(mutation.id)
    const syncDiagnostic = await members.getSyncState()
    expect(confirmed.state, JSON.stringify({ confirmed: confirmed.state, sync: syncDiagnostic.state, pending: syncDiagnostic.pendingChanges, failed: syncDiagnostic.failedChanges, lastError: syncDiagnostic.lastError })).toBe(MEMBER_SAVE_STATES.SERVER_CONFIRMED)

    const attendanceDate = '2025-12-07'
    const column = 'attendance_2025_12_07'
    const ensureColumn = await fixture.client.rpc('ensure_workspace_attendance_column', {
      p_owner_id: fixture.userId,
      p_month_start: '2025-12-01',
      p_attendance_date: attendanceDate,
    })
    expect(ensureColumn.error).toBeNull()
    const attendance = await createMemberAttendanceService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: getRxStorageMemory(), online: () => true })
    activeServices.push(attendance)
    await attendance.start()
    const v2Save = await attendance.saveAttendance({ memberId: created.id, tableName: fixture.tableName, attendanceDate, status: 'Present' })
    await attendance.syncNow()
    await attendance.syncNow()
    const attendanceState = await attendance.getSyncState()
    const failedMutation = await attendance.database.mutations.findOne(v2Save.requestId).exec()
    const v2Row = await fixture.admin.from(fixture.tableName).select(`"${column}"`).eq('id', created.id).single()
    expect(v2Row.error).toBeNull()
    expect(v2Row.data[column], JSON.stringify({ state: attendanceState.state, pending: attendanceState.pendingChanges, lastError: attendanceState.lastError, mutationError: failedMutation?.toJSON?.().last_error })).toBe('Present')
    const replayFingerprint = await createMemberV2AttendanceFingerprint({ operation: 'set_member_v2_attendance', ownerId: fixture.userId, memberId: created.id, tableName: fixture.tableName, attendanceDate, status: 'Present', baseServerRevision: null })
    const replay = await fixture.client.rpc('save_member_v2_attendance', {
      p_owner_id: fixture.userId, p_member_id: created.id, p_table_name: fixture.tableName,
      p_attendance_date: attendanceDate, p_attendance_status: 'Present',
      p_attendance_id: v2Save.attendance.attendance_id, p_base_server_revision: null,
      p_request_id: v2Save.requestId, p_payload_fingerprint: replayFingerprint,
    })
    expect(replay.error).toBeNull()
    expect(replay.data?.status).toBe('IDEMPOTENT_REPLAY')
    const conflictFingerprint = await createMemberV2AttendanceFingerprint({ operation: 'set_member_v2_attendance', ownerId: fixture.userId, memberId: created.id, tableName: fixture.tableName, attendanceDate, status: 'Absent', baseServerRevision: null })
    const conflict = await fixture.client.rpc('save_member_v2_attendance', {
      p_owner_id: fixture.userId, p_member_id: created.id, p_table_name: fixture.tableName,
      p_attendance_date: attendanceDate, p_attendance_status: 'Absent',
      p_attendance_id: v2Save.attendance.attendance_id, p_base_server_revision: null,
      p_request_id: crypto.randomUUID(), p_payload_fingerprint: conflictFingerprint,
    })
    expect(conflict.error).toBeNull()
    expect(conflict.data?.status).toBe('CONFLICT')

    const legacy = await fixture.client.rpc('set_workspace_month_member_attendance', {
      p_owner_id: fixture.userId,
      p_month_start: '2025-12-01',
      p_member_id: created.id,
      p_attendance_date: attendanceDate,
      p_attendance_status: 'Absent',
      p_request_id: crypto.randomUUID(),
    })
    expect(legacy.error).toBeNull()
    expect(legacy.data).toMatchObject({ success: true })
    await attendance.syncNow({ pullOnly: true })
    await attendance.syncNow({ pullOnly: true })
    expect((await attendance.getForMember(created.id))[0]).toMatchObject({ status: 'Absent', save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED })
    const legacyRow = await fixture.admin.from(fixture.tableName).select(`"${column}"`).eq('id', created.id).single()
    expect(legacyRow.data[column]).toBe('Absent')

    const nextMonth = await fixture.client.rpc('create_workspace_month', {
      p_owner_id: fixture.userId, p_year: 2026, p_month: 1, p_source_month: null, p_copy_mode: 'empty', p_member_ids: [],
    })
    expect(nextMonth.error).toBeNull()
    const crossMonth = await fixture.client.rpc('set_member_attendance_from_other_month', {
      p_owner_id: fixture.userId,
      p_source_month: '2025-12-01',
      p_target_month: '2026-01-01',
      p_member_id: created.id,
      p_attendance_date: '2026-01-04',
      p_attendance_status: 'Present',
      p_request_id: crypto.randomUUID(),
    })
    expect(crossMonth.error).toBeNull()
    expect(crossMonth.data, JSON.stringify(crossMonth.data)).toMatchObject({ success: true })
    await attendance.syncNow({ pullOnly: true })
    await attendance.syncNow({ pullOnly: true })
    expect((await attendance.getForMember(created.id)).find((row) => row.attendance_date === '2026-01-04')).toMatchObject({
      table_name: nextMonth.data.table_name, status: 'Present', save_state: MEMBER_SAVE_STATES.SERVER_CONFIRMED,
    })
    const crossMonthRow = await fixture.admin.from(nextMonth.data.table_name).select('attendance_2026_01_04').eq('id', created.id).single()
    expect(crossMonthRow.error).toBeNull()
    expect(crossMonthRow.data.attendance_2026_01_04).toBe('Present')

    const changes = await fixture.admin.from('member_v2_change_events').select('server_revision, attendance_status, operation_name')
      .eq('owner_id', fixture.userId).eq('table_name', fixture.tableName).eq('member_id', created.id).eq('attendance_date', attendanceDate)
      .order('server_revision')
    expect(changes.error).toBeNull()
    expect(changes.data.map((change) => change.attendance_status)).toEqual(['Present', 'Absent'])
    expect(changes.data).toHaveLength(2)
    const crossMonthChanges = await fixture.admin.from('member_v2_change_events').select('attendance_status,operation_name')
      .eq('owner_id', fixture.userId).eq('table_name', nextMonth.data.table_name).eq('member_id', created.id).eq('attendance_date', '2026-01-04')
    expect(crossMonthChanges.error).toBeNull()
    expect(crossMonthChanges.data).toEqual([{ attendance_status: 'Present', operation_name: 'legacy_attendance_write' }])
    } finally {
      await Promise.all(activeServices.map((service) => service.stop()))
    }
  }, 30000)

  it('round-trips real phones and the No Phone zero sentinel through local Member V2 storage and pull', async () => {
    let online = true
    const firstStorage = getRxStorageMemory()
    const first = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: firstStorage, online: () => online })
    await first.start()

    const real = await first.createMember({ tableName: fixture.tableName, member: { full_name: 'Synthetic phone control', phone_number: '0551234567' } })
    const realCreateMutation = (await first.database.mutations.find({ selector: { member_id: real.id, operation: 'create_member_v2' } }).exec())[0].toJSON()
    expect(realCreateMutation.payload['Phone Number']).toBe('0551234567')
    await first.syncNow()
    await first.syncNow()
    await first.awaitServerConfirmation(realCreateMutation.id)
    const realLocal = await first.getMember(real.id)
    expect({ state: realLocal.save_state, error: realLocal.last_error }).toEqual({ state: MEMBER_SAVE_STATES.SERVER_CONFIRMED, error: null })
    const realServer = await fixture.client.from(fixture.tableName).select('"Phone Number"').eq('id', real.id).single()
    expect(realServer.error).toBeNull()
    expect(realServer.data['Phone Number']).toBe(551234567)

    await first.updateMember(real.id, { phone_number: '0000000000' })
    const realPhoneUpdate = (await first.database.mutations.find({ selector: { member_id: real.id, operation: 'update_member_v2' } }).exec())[0].toJSON()
    expect(realPhoneUpdate.payload['Phone Number']).toBe('0000000000')
    await first.syncNow()
    await first.syncNow()
    await first.awaitServerConfirmation(realPhoneUpdate.id)
    const editedServer = await fixture.client.from(fixture.tableName).select('"Phone Number"').eq('id', real.id).single()
    expect(editedServer.data['Phone Number']).toBe(0)

    const noPhone = await first.createMember({ tableName: fixture.tableName, member: { full_name: 'Synthetic no phone create', phone_number: '0000000000' } })
    const noPhoneMutation = (await first.database.mutations.find({ selector: { member_id: noPhone.id, operation: 'create_member_v2' } }).exec())[0].toJSON()
    expect(noPhoneMutation.payload['Phone Number']).toBe('0000000000')
    await first.syncNow()
    await first.syncNow()
    await first.awaitServerConfirmation(noPhoneMutation.id)
    const noPhoneServer = await fixture.client.from(fixture.tableName).select('"Phone Number"').eq('id', noPhone.id).single()
    expect(noPhoneServer.error).toBeNull()
    expect(noPhoneServer.data['Phone Number']).toBe(0)
    const noPhonePull = await fixture.client.rpc('pull_workspace_member_changes_v2', { p_owner_id: fixture.userId, p_after_server_revision: 0, p_limit: 100 })
    expect(noPhonePull.error).toBeNull()
    expect(noPhonePull.data.changes.filter((change) => change.member_id === noPhone.id).at(-1).member['Phone Number']).toBe(0)
    expect((await first.getMember(noPhone.id)).data['Phone Number']).toBe(0)

    online = false
    await first.updateMember(noPhone.id, { full_name: 'Synthetic no phone edited offline' })
    expect((await first.getMember(noPhone.id)).data['Phone Number']).toBe(0)
    const offlineUpdate = (await first.database.mutations.find({ selector: { member_id: noPhone.id, operation: 'update_member_v2' } }).exec())[0].toJSON()
    const offlineServer = await fixture.client.from(fixture.tableName).select('"Phone Number"').eq('id', noPhone.id).single()
    expect(offlineServer.data['Phone Number']).toBe(0)
    online = true
    await first.syncNow()
    await first.syncNow()
    await first.awaitServerConfirmation(offlineUpdate.id)
    const finalServer = await fixture.client.from(fixture.tableName).select('"Phone Number"').eq('id', noPhone.id).single()
    expect(finalServer.data['Phone Number']).toBe(0)
    await first.stop()

    const pulled = await createMemberService({ supabase: fixture.client, userId: fixture.userId, ownerId: fixture.userId, storage: getRxStorageMemory(), online: () => true })
    await pulled.start()
    await pulled.pull()
    expect((await pulled.getMember(real.id)).data['Phone Number']).toBe(0)
    expect((await pulled.getMember(noPhone.id)).data['Phone Number']).toBe(0)
    expect(offlineUpdate.id).toMatch(/^update_member_v2:/)
    const noPhonePendingMutations = await pulled.database.mutations.find({ selector: { member_id: noPhone.id } }).exec()
    expect(noPhonePendingMutations).toHaveLength(0)
    await pulled.stop()
  }, 30000)
})
