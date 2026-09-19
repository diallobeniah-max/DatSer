import { afterEach, describe, expect, it } from 'vitest'
import {
  assertLegacyMemberFlowIsSafe,
  getMemberV2LocalFlowGuard,
  getMemberV2LocalFlowStatus,
  isMemberV2LocalExperimentEnabled,
  updateMemberV2LocalFlowGuard,
} from './memberV2FeatureFlag'

const ids = {
  userId: '11111111-1111-4111-8111-111111111111',
  ownerId: '22222222-2222-4222-8222-222222222222',
}

const storage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const localEnv = {
  DEV: true,
  VITE_DATSER_MEMBER_V2_EXPERIMENT: 'true',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
}

describe('Member V2 local feature boundary', () => {
  afterEach(() => {
    // No global Vite environment or browser storage is modified by these tests.
  })

  it('requires an explicit local Vite opt-in and rejects hosted URLs', () => {
    expect(isMemberV2LocalExperimentEnabled(localEnv)).toBe(true)
    expect(isMemberV2LocalExperimentEnabled({ ...localEnv, VITE_SUPABASE_URL: 'https://example.supabase.co' })).toBe(false)
    expect(isMemberV2LocalExperimentEnabled({ ...localEnv, DEV: false })).toBe(false)
    expect(isMemberV2LocalExperimentEnabled({ ...localEnv, VITE_DATSER_MEMBER_V2_EXPERIMENT: 'false' })).toBe(false)
  })

  it('blocks a local legacy fallback while Member V2 has unsynced work', () => {
    const localStorage = storage()
    updateMemberV2LocalFlowGuard({
      ...ids,
      storage: localStorage,
      syncState: { state: 'OFFLINE_PENDING', pendingChanges: 1, failedChanges: 0, conflicts: 0 },
    })
    expect(getMemberV2LocalFlowGuard({ ...ids, storage: localStorage })).toMatchObject({ pendingChanges: 1 })
    expect(() => assertLegacyMemberFlowIsSafe({
      ...ids,
      storage: localStorage,
      env: { DEV: true, VITE_DATSER_MEMBER_V2_EXPERIMENT: 'false', VITE_SUPABASE_URL: 'http://127.0.0.1:54321' },
    })).toThrow(/unsynced local work/i)
  })

  it('clears the local guard only after all pending, failed, and conflict work is gone', () => {
    const localStorage = storage()
    updateMemberV2LocalFlowGuard({ ...ids, storage: localStorage, syncState: { state: 'CONFLICT', pendingChanges: 0, failedChanges: 0, conflicts: 1 } })
    expect(getMemberV2LocalFlowGuard({ ...ids, storage: localStorage })).not.toBeNull()
    updateMemberV2LocalFlowGuard({ ...ids, storage: localStorage, syncState: { state: 'SYNCED', pendingChanges: 0, failedChanges: 0, conflicts: 0 } })
    expect(getMemberV2LocalFlowGuard({ ...ids, storage: localStorage })).toBeNull()
  })

  it('does not present Member V2 as synced while durable work is pending, failed, or conflicted', () => {
    expect(getMemberV2LocalFlowStatus({ pendingChanges: 1 }, { offline: false })).toMatchObject({ label: 'Sync pending', tone: 'pending' })
    expect(getMemberV2LocalFlowStatus({ pendingChanges: 1 }, { offline: true })).toMatchObject({ label: 'Offline changes', tone: 'offline' })
    expect(getMemberV2LocalFlowStatus({ pendingChanges: 3, failedChanges: 1 })).toMatchObject({ label: 'Sync needs retry', tone: 'failed' })
    expect(getMemberV2LocalFlowStatus({ pendingChanges: 3, conflicts: 1 })).toMatchObject({ label: 'Conflict needs review', tone: 'conflict' })
    expect(getMemberV2LocalFlowStatus(null)).toBeNull()
  })
})
