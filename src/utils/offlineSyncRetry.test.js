import { describe, expect, it } from 'vitest'
import {
  SYNC_RETRY_LIMIT,
  coalesceOfflineChange,
  getChangeNextAttemptAt,
  getNextFailureSyncStatus,
  getSyncBackoffDelayMs,
  getSyncableChangesNextAttemptDelayMs,
  isChangeRetryEligible,
  isChangeSyncable,
  resolveServerDeletedMemberChange
} from './offlineStore'

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0)
const iso = (ms) => new Date(ms).toISOString()

const pendingChange = (overrides = {}) => ({
  local_change_id: 'member_update_July_2026_member-1',
  action_type: 'member_update',
  table_name: 'July_2026',
  member_id: 'member-1',
  updates: { full_name: 'Synthetic Member' },
  sync_status: 'pending',
  created_at: iso(T0 - 60_000),
  ...overrides
})

describe('sync backoff policy', () => {
  it('increases the retry delay for each failed attempt and caps it', () => {
    expect(getSyncBackoffDelayMs(0)).toBe(30_000)
    expect(getSyncBackoffDelayMs(1)).toBe(60_000)
    expect(getSyncBackoffDelayMs(2)).toBe(120_000)
    expect(getSyncBackoffDelayMs(3)).toBe(300_000)
    expect(getSyncBackoffDelayMs(4)).toBe(900_000)
    expect(getSyncBackoffDelayMs(5)).toBe(900_000)
    expect(getSyncBackoffDelayMs(99)).toBe(900_000)
  })

  it('never-attempted changes are eligible immediately (first save is not delayed)', () => {
    const change = pendingChange()
    expect(isChangeRetryEligible(change, T0)).toBe(true)
    expect(getSyncableChangesNextAttemptDelayMs([change], T0)).toBe(0)
  })

  it('a recent transient failure does not allow an immediate reflush', () => {
    const change = pendingChange({
      retry_count: 1,
      last_attempt_at: iso(T0)
    })
    expect(isChangeRetryEligible(change, T0 + 5_000)).toBe(false)
    expect(getChangeNextAttemptAt(change, T0 + 5_000)).toBe(T0 + 60_000)
    expect(getSyncableChangesNextAttemptDelayMs([change], T0 + 5_000)).toBe(55_000)
  })

  it('becomes eligible again once the backoff window has elapsed', () => {
    const change = pendingChange({
      retry_count: 1,
      last_attempt_at: iso(T0)
    })
    expect(isChangeRetryEligible(change, T0 + 60_000)).toBe(true)
    expect(getSyncableChangesNextAttemptDelayMs([change], T0 + 60_000)).toBe(0)
  })

  it('uses the earliest next attempt when several changes are backing off', () => {
    const first = pendingChange({ retry_count: 1, last_attempt_at: iso(T0) })
    const second = pendingChange({
      local_change_id: 'member_add_member-2',
      member_id: 'member-2',
      retry_count: 4,
      last_attempt_at: iso(T0)
    })
    expect(getSyncableChangesNextAttemptDelayMs([first, second], T0 + 5_000)).toBe(55_000)
  })
})

describe('sync retry budget', () => {
  it('stops automatic hammering once the budget is spent', () => {
    const exhausted = pendingChange({
      retry_count: SYNC_RETRY_LIMIT,
      last_attempt_at: iso(T0 - 24 * 60 * 60 * 1000)
    })
    expect(isChangeRetryEligible(exhausted, T0)).toBe(false)
    expect(getSyncableChangesNextAttemptDelayMs([exhausted], T0)).toBe(null)
  })

  it('an exhausted change never forces an immediate schedule next to others', () => {
    const exhausted = pendingChange({
      retry_count: SYNC_RETRY_LIMIT,
      last_attempt_at: iso(T0)
    })
    const backingOff = pendingChange({
      local_change_id: 'member_add_member-2',
      member_id: 'member-2',
      retry_count: 1,
      last_attempt_at: iso(T0 - 5_000)
    })
    expect(getSyncableChangesNextAttemptDelayMs([exhausted, backingOff], T0)).toBe(55_000)
  })

  it('spends the budget only on failures, keeping the change recoverable', () => {
    let change = pendingChange()
    for (let attempt = 1; attempt <= SYNC_RETRY_LIMIT; attempt += 1) {
      const state = getNextFailureSyncStatus(change, { transient: true })
      change = { ...change, ...state, last_attempt_at: iso(T0 + attempt * 1000) }
      if (attempt < SYNC_RETRY_LIMIT) {
        expect(change.sync_status).toBe('pending')
        expect(change.error).toBeNull()
        expect(change.retry_count).toBe(attempt)
      }
    }
    expect(change.sync_status).toBe('failed')
    expect(change.retry_count).toBe(SYNC_RETRY_LIMIT)
    expect(change.error).toMatch(/retry from Settings/i)
    expect(isChangeSyncable(change)).toBe(false)
    expect(isChangeRetryEligible(change, T0 + 100_000)).toBe(false)
  })

  it('moves a non-transient failure to failed immediately with no budget message', () => {
    const state = getNextFailureSyncStatus(pendingChange(), { transient: false })
    expect(state).toEqual({ sync_status: 'failed', retry_count: 1, error: null })
  })

  it('a successful retry clears the retry state for new work', () => {
    const exhausted = pendingChange({
      sync_status: 'failed',
      retry_count: SYNC_RETRY_LIMIT,
      last_attempt_at: iso(T0)
    })
    const reQueued = coalesceOfflineChange(
      [exhausted],
      {
        local_change_id: exhausted.local_change_id,
        action_type: 'member_update',
        table_name: 'July_2026',
        member_id: 'member-1',
        updates: { parent_name_1: 'Synthetic Guardian' },
        created_at: iso(T0 + 1000)
      },
      iso(T0 + 2000)
    )
    expect(reQueued.queuedChange.sync_status).toBe('pending')
    expect(reQueued.queuedChange.retry_count).toBe(0)
    expect(isChangeRetryEligible(reQueued.queuedChange, T0 + 2000)).toBe(true)
  })
})

describe('reload safety', () => {
  it('does not create an immediate request storm after reload with recent failures', () => {
    const changes = [
      pendingChange({ retry_count: 1, last_attempt_at: iso(T0 - 5_000) }),
      pendingChange({ local_change_id: 'x2', member_id: 'm2', retry_count: 2, last_attempt_at: iso(T0 - 2_000) })
    ]
    expect(changes.every((change) => !isChangeRetryEligible(change, T0))).toBe(true)
    expect(getSyncableChangesNextAttemptDelayMs(changes, T0)).toBe(55_000)
  })

  it('does not schedule anything when only budget-exhausted work remains', () => {
    const changes = [
      pendingChange({ sync_status: 'failed', retry_count: SYNC_RETRY_LIMIT }),
      pendingChange({ sync_status: 'conflict', retry_count: 2 })
    ]
    expect(getSyncableChangesNextAttemptDelayMs(changes, T0)).toBe(null)
  })
})

describe('server-deleted member reconciliation', () => {
  it('does not resurrect a member explicitly deleted on the server (member_add)', () => {
    const add = { action_type: 'member_add', member_id: 'member-1' }
    expect(resolveServerDeletedMemberChange(add, { id: 'member-1', deleted_at: iso(T0) }).action).toBe('fail')
  })

  it('proceeds with a member_add when the server row is absent (new offline member)', () => {
    const add = { action_type: 'member_add', member_id: 'member-1' }
    expect(resolveServerDeletedMemberChange(add, null).action).toBe('proceed')
    expect(resolveServerDeletedMemberChange(add, undefined).action).toBe('proceed')
    expect(resolveServerDeletedMemberChange(add, { id: 'member-1', deleted_at: null }).action).toBe('proceed')
  })

  it('stops repeat retries for updates/attendance against a deleted member', () => {
    const update = { action_type: 'member_update', member_id: 'member-1' }
    const attendance = { action_type: 'attendance_mark', member_id: 'member-1' }
    const resolution = resolveServerDeletedMemberChange(update, { id: 'member-1', deleted_at: iso(T0) })
    expect(resolution.action).toBe('fail')
    expect(resolution.error).toMatch(/deleted on the server/i)
    expect(resolveServerDeletedMemberChange(attendance, { id: 'member-1', deleted_at: iso(T0) }).action).toBe('fail')
    expect(resolveServerDeletedMemberChange(update, { id: 'member-1', deleted_at: null }).action).toBe('proceed')
  })

  it('retires a member_delete only against an explicitly soft-deleted row', () => {
    const del = { action_type: 'member_delete', member_id: 'member-1' }
    expect(resolveServerDeletedMemberChange(del, { id: 'member-1', deleted_at: iso(T0) }).action).toBe('remove')
    expect(resolveServerDeletedMemberChange(del, null).action).toBe('fail')
    expect(resolveServerDeletedMemberChange(del, { id: 'member-1', deleted_at: null }).action).toBe('proceed')
  })
})
