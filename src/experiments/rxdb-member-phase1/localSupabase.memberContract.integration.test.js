import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { readLocalSupabase, readLocalSupabaseDbContainer } from '../rxdb-backend-poc/testing/localSupabaseFixture'
import { createMemberV2Fingerprint } from './memberContractFingerprint'

const fixture = {}

const runLocalSql = (sql) => {
  const docker = process.platform === 'win32'
    ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
    : 'docker'
  const container = readLocalSupabaseDbContainer()
  execFileSync(docker, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], { stdio: 'ignore' })
}

const makeUser = async (admin, config, label) => {
  const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const email = `member-v2-${label}-${nonce}@local.invalid`
  const password = `MemberV2-${crypto.randomUUID()}-9a!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  return { id: data.user.id, email, client }
}

const memberPayload = (name, phone = '0240000000') => ({
  'Full Name': name,
  'Phone Number': phone,
  Gender: 'Female',
  Age: '18',
  'Current Level': 'Completed',
})

const createMutation = async ({ client, ownerId, tableName = fixture.tableName, memberId = crypto.randomUUID(), requestId = crypto.randomUUID(), payload = memberPayload(`Member ${Date.now()}`) }) => {
  const fingerprint = await createMemberV2Fingerprint({
    operation: 'create_member_v2', ownerId, tableName, memberId, payload,
  })
  const response = await client.rpc('create_member_v2', {
    p_table_name: tableName,
    p_owner_id: ownerId,
    p_member_id: memberId,
    p_member: payload,
    p_request_id: requestId,
    p_payload_fingerprint: fingerprint,
  })
  return { ...response, memberId, requestId, payload, fingerprint }
}

const updateMutation = async ({ client, ownerId, tableName = fixture.tableName, memberId, baseServerRevision, requestId = crypto.randomUUID(), updates }) => {
  const fingerprint = await createMemberV2Fingerprint({
    operation: 'update_member_v2', ownerId, tableName, memberId, baseServerRevision, payload: updates,
  })
  const response = await client.rpc('update_member_v2', {
    p_table_name: tableName,
    p_owner_id: ownerId,
    p_member_id: memberId,
    p_updates: updates,
    p_base_server_revision: baseServerRevision,
    p_request_id: requestId,
    p_payload_fingerprint: fingerprint,
    p_identity: { full_name: 'safe identity hint' },
  })
  return { ...response, requestId, fingerprint }
}

beforeAll(async () => {
  const config = readLocalSupabase()
  fixture.config = config
  fixture.admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  fixture.owner = await makeUser(fixture.admin, config, 'owner')
  fixture.collaborator = await makeUser(fixture.admin, config, 'collaborator')
  fixture.other = await makeUser(fixture.admin, config, 'other')
  fixture.anon = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const ownerMonth = await fixture.owner.client.rpc('create_workspace_month', {
    p_owner_id: fixture.owner.id,
    p_year: 2025,
    p_month: 12,
    p_source_month: null,
    p_copy_mode: 'empty',
    p_member_ids: [],
  })
  if (ownerMonth.error) throw ownerMonth.error
  fixture.tableName = ownerMonth.data.table_name
  const rollout = await fixture.admin.from('member_v2_rollout_workspaces').upsert({ owner_id: fixture.owner.id, enabled: true })
  if (rollout.error) throw rollout.error

  const otherMonth = await fixture.other.client.rpc('create_workspace_month', {
    p_owner_id: fixture.other.id,
    p_year: 2025,
    p_month: 12,
    p_source_month: null,
    p_copy_mode: 'empty',
    p_member_ids: [],
  })
  if (otherMonth.error) throw otherMonth.error
  expect(otherMonth.data.table_name).toBe(fixture.tableName)

  const collaborator = await fixture.owner.client.from('collaborators').insert({
    owner_id: fixture.owner.id,
    collaborator_user_id: fixture.collaborator.id,
    email: fixture.collaborator.email,
    status: 'accepted',
    is_admin: false,
  })
  if (collaborator.error) throw collaborator.error
})

describe.sequential('RxDB member Phase 1 trusted server contract', () => {
  it('makes the client UUID canonical, assigns a code, and safely replays a lost response', async () => {
    const create = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Canonical Create') })
    expect(create.error).toBeNull()
    expect(create.data).toMatchObject({ status: 'SUCCESS', member_id: create.memberId })
    expect(create.data.member.member_code).toBeTruthy()
    expect(create.data.server_revision).toBeGreaterThan(0)

    const retry = await fixture.owner.client.rpc('create_member_v2', {
      p_table_name: fixture.tableName,
      p_owner_id: fixture.owner.id,
      p_member_id: create.memberId,
      p_member: create.payload,
      p_request_id: create.requestId,
      p_payload_fingerprint: create.fingerprint,
    })
    expect(retry.error).toBeNull()
    expect(retry.data).toMatchObject({ status: 'IDEMPOTENT_REPLAY', member_id: create.memberId, original_status: 'SUCCESS' })
    const rows = await fixture.owner.client.rpc('pull_workspace_member_changes_v2', {
      p_owner_id: fixture.owner.id,
      p_after_server_revision: create.data.server_revision - 1,
      p_limit: 1,
    })
    expect(rows.error).toBeNull()
    expect(rows.data.changes).toContainEqual(expect.objectContaining({ member_id: create.memberId }))
  })

  it('rejects changed payloads and changed operations for an existing request id', async () => {
    const create = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Fingerprint Base') })
    expect(create.error).toBeNull()
    const changed = await createMutation({
      client: fixture.owner.client,
      ownerId: fixture.owner.id,
      memberId: create.memberId,
      requestId: create.requestId,
      payload: memberPayload('Fingerprint Changed'),
    })
    expect(changed.error?.message).toMatch(/Request id was already used/)

    const changedOperation = await updateMutation({
      client: fixture.owner.client,
      ownerId: fixture.owner.id,
      memberId: create.memberId,
      baseServerRevision: create.data.server_revision,
      requestId: create.requestId,
      updates: { notes: 'different operation' },
    })
    expect(changedOperation.error?.message).toMatch(/Request id was already used/)
  })

  it('allows an intended collaborator but denies another workspace and anonymous callers', async () => {
    const collaboratorCreate = await createMutation({
      client: fixture.collaborator.client,
      ownerId: fixture.owner.id,
      payload: memberPayload('Collaborator Create'),
    })
    expect(collaboratorCreate.error).toBeNull()
    expect(collaboratorCreate.data.member.workspace_owner_id).toBe(fixture.owner.id)
    const collaboratorUpdate = await updateMutation({
      client: fixture.collaborator.client,
      ownerId: fixture.owner.id,
      memberId: collaboratorCreate.memberId,
      baseServerRevision: collaboratorCreate.data.server_revision,
      updates: { notes: 'updated by the authorized collaborator' },
    })
    expect(collaboratorUpdate.error).toBeNull()
    expect(collaboratorUpdate.data.status).toBe('SUCCESS')

    const crossWorkspace = await createMutation({
      client: fixture.other.client,
      ownerId: fixture.owner.id,
      payload: memberPayload('Denied Cross Workspace'),
    })
    expect(crossWorkspace.error?.message).toMatch(/Not authorized/)

    const anonymous = await createMutation({
      client: fixture.anon,
      ownerId: fixture.owner.id,
      payload: memberPayload('Denied Anonymous'),
    })
    expect(anonymous.error).not.toBeNull()
  })

  it('prevents a UUID claimed in another workspace from becoming a second member', async () => {
    const create = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('UUID Claim') })
    expect(create.error).toBeNull()
    const allowOtherForClaimCheck = await fixture.admin.from('member_v2_rollout_workspaces').upsert({ owner_id: fixture.other.id, enabled: true })
    expect(allowOtherForClaimCheck.error).toBeNull()
    const conflict = await createMutation({
      client: fixture.other.client,
      ownerId: fixture.other.id,
      memberId: create.memberId,
      payload: memberPayload('UUID Claim Cross Workspace'),
    })
    expect(conflict.error?.message).toMatch(/UUID is already claimed/)
    const clearOtherRollout = await fixture.admin.from('member_v2_rollout_workspaces').delete().eq('owner_id', fixture.other.id)
    expect(clearOtherRollout.error).toBeNull()
  })

  it('updates with a matching revision, preserves identity and code, and replays safely', async () => {
    const create = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Profile Before') })
    const originalCode = create.data.member.member_code
    const update = await updateMutation({
      client: fixture.owner.client,
      ownerId: fixture.owner.id,
      memberId: create.memberId,
      baseServerRevision: create.data.server_revision,
      updates: { 'Full Name': 'Profile After', 'Phone Number': '0555000000' },
    })
    expect(update.error).toBeNull()
    expect(update.data).toMatchObject({ status: 'SUCCESS', member_id: create.memberId, table_name: fixture.tableName })
    expect(update.data.member['Full Name']).toBe('Profile After')
    expect(update.data.member.member_code).toBe(originalCode)
    expect(update.data.member.__source_table).toBe(fixture.tableName)
    expect(update.data.member.__canonical_member_id).toBe(create.memberId)

    const retry = await fixture.owner.client.rpc('update_member_v2', {
      p_table_name: fixture.tableName,
      p_owner_id: fixture.owner.id,
      p_member_id: create.memberId,
      p_updates: { 'Full Name': 'Profile After', 'Phone Number': '0555000000' },
      p_base_server_revision: create.data.server_revision,
      p_request_id: update.requestId,
      p_payload_fingerprint: update.fingerprint,
      p_identity: {},
    })
    expect(retry.error).toBeNull()
    expect(retry.data.status).toBe('IDEMPOTENT_REPLAY')
  })

  it('returns a deterministic conflict without overwriting the authoritative row', async () => {
    const create = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Conflict Before') })
    const winning = await updateMutation({
      client: fixture.owner.client,
      ownerId: fixture.owner.id,
      memberId: create.memberId,
      baseServerRevision: create.data.server_revision,
      updates: { notes: 'authoritative remote edit' },
    })
    expect(winning.data.status).toBe('SUCCESS')

    const stale = await updateMutation({
      client: fixture.owner.client,
      ownerId: fixture.owner.id,
      memberId: create.memberId,
      baseServerRevision: create.data.server_revision,
      updates: { notes: 'must not overwrite' },
    })
    expect(stale.error).toBeNull()
    expect(stale.data).toMatchObject({
      status: 'CONFLICT',
      member_id: create.memberId,
      base_server_revision: create.data.server_revision,
      server_revision: winning.data.server_revision,
    })
    expect(stale.data.member.notes).toBe('authoritative remote edit')
  })

  it('returns deterministic bounded cursor pages without skips or duplicates', async () => {
    const first = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Pull First') })
    const second = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Pull Second') })
    expect(second.data.server_revision).toBeGreaterThan(first.data.server_revision)

    const pageOne = await fixture.owner.client.rpc('pull_workspace_member_changes_v2', {
      p_owner_id: fixture.owner.id, p_after_server_revision: first.data.server_revision - 1, p_limit: 1,
    })
    expect(pageOne.error).toBeNull()
    expect(pageOne.data.changes).toHaveLength(1)
    expect(pageOne.data.next_cursor).toBe(first.data.server_revision)

    const pageTwo = await fixture.owner.client.rpc('pull_workspace_member_changes_v2', {
      p_owner_id: fixture.owner.id, p_after_server_revision: pageOne.data.next_cursor, p_limit: 100,
    })
    expect(pageTwo.error).toBeNull()
    const ids = pageTwo.data.changes.map((change) => change.member_id)
    expect(ids).toContain(second.memberId)
    expect(ids).not.toContain(first.memberId)
  })

  it('publishes a soft-delete tombstone through the member cursor', async () => {
    const create = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Tombstone') })
    // Some existing historical month tables predate soft deletion. Add the
    // supported server field only to this disposable local test table so this
    // exercises the real legacy soft-delete path and the replication trigger.
    runLocalSql(`alter table public."${fixture.tableName}" add column if not exists deleted_at timestamptz`)
    const deleted = await fixture.owner.client.rpc('soft_delete_member', {
      p_table_name: fixture.tableName, p_member_id: create.memberId, p_owner_id: fixture.owner.id,
    })
    expect(deleted.error).toBeNull()
    expect(deleted.data).toBe(true)
    const pull = await fixture.owner.client.rpc('pull_workspace_member_changes_v2', {
      p_owner_id: fixture.owner.id, p_after_server_revision: create.data.server_revision, p_limit: 100,
    })
    expect(pull.error).toBeNull()
    expect(pull.data.changes).toContainEqual(expect.objectContaining({ member_id: create.memberId, is_deleted: true }))
  })

  it('rolls back a failed post-reservation create without leaving idempotency state', async () => {
    const create = await createMutation({ client: fixture.owner.client, ownerId: fixture.owner.id, payload: memberPayload('Rollback Source') })
    const failedRequestId = crypto.randomUUID()
    const failed = await createMutation({
      client: fixture.owner.client,
      ownerId: fixture.owner.id,
      memberId: create.memberId,
      requestId: failedRequestId,
      payload: memberPayload('Rollback Must Not Persist'),
    })
    expect(failed.error?.message).toMatch(/UUID is already claimed/)
    const reservation = await fixture.admin.from('member_v2_mutations').select('request_id').eq('request_id', failedRequestId)
    expect(reservation.data).toEqual([])
  })

  it('rolls back a member create when code allocation fails, then safely recovers on retry', async () => {
    const memberId = crypto.randomUUID()
    const requestId = crypto.randomUUID()
    runLocalSql(`
      create or replace function public.member_v2_test_block_code_allocation()
      returns trigger language plpgsql as $$
      begin
        if new.member_id = '${memberId}'::uuid then
          raise exception 'synthetic member-code allocation failure';
        end if;
        return new;
      end;
      $$;
      create trigger member_v2_test_block_code_allocation
      before insert on public.workspace_member_codes
      for each row execute function public.member_v2_test_block_code_allocation();
    `)
    try {
      const failed = await createMutation({
        client: fixture.owner.client,
        ownerId: fixture.owner.id,
        memberId,
        requestId,
        payload: memberPayload('Code Allocation Rollback'),
      })
      expect(failed.error?.message).toMatch(/synthetic member-code allocation failure/)
    } finally {
      runLocalSql(`
        drop trigger if exists member_v2_test_block_code_allocation on public.workspace_member_codes;
        drop function if exists public.member_v2_test_block_code_allocation();
      `)
    }
    const recovered = await createMutation({
      client: fixture.owner.client,
      ownerId: fixture.owner.id,
      memberId,
      requestId,
      payload: memberPayload('Code Allocation Rollback'),
    })
    expect(recovered.error).toBeNull()
    expect(recovered.data).toMatchObject({ status: 'SUCCESS', member_id: memberId })
    expect(recovered.data.member.member_code).toBeTruthy()
  })

  it('denies cross-workspace pulls and permits collaborator pulls', async () => {
    const collaboratorPull = await fixture.collaborator.client.rpc('pull_workspace_member_changes_v2', {
      p_owner_id: fixture.owner.id, p_after_server_revision: 0, p_limit: 1,
    })
    expect(collaboratorPull.error).toBeNull()
    const otherPull = await fixture.other.client.rpc('pull_workspace_member_changes_v2', {
      p_owner_id: fixture.owner.id, p_after_server_revision: 0, p_limit: 1,
    })
    expect(otherPull.error?.message).toMatch(/Not authorized/)
  })

  it('keeps the server rollout gate off for a registered workspace without an explicit allowlist row', async () => {
    const month = await fixture.other.client.rpc('create_workspace_month', {
      p_owner_id: fixture.other.id,
      p_year: 2024,
      p_month: 12,
      p_source_month: null,
      p_copy_mode: 'empty',
      p_member_ids: [],
    })
    expect(month.error).toBeNull()
    const blocked = await createMutation({ client: fixture.other.client, ownerId: fixture.other.id, tableName: month.data.table_name, payload: memberPayload('Gate remains off') })
    expect(blocked.error?.message).toMatch(/mutations are not enabled/i)
    const allowlist = await fixture.admin.from('member_v2_rollout_workspaces').select('enabled').eq('owner_id', fixture.other.id).maybeSingle()
    expect(allowlist.error).toBeNull()
    expect(allowlist.data).toBeNull()
  })
})
