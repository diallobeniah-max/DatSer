import { describe, expect, it, vi } from 'vitest'
import { syncQueuedMemberDelete } from './offlineDeleteRetry'

const noRowsError = { code: '42501', message: 'Trusted soft delete affected 0 rows' }
const networkError = { message: 'Failed to fetch' }
const authError = { code: '42501', message: 'permission denied' }

describe('queued member delete idempotency', () => {
  it('clears after a normal soft_delete_member success', async () => {
    const readMember = vi.fn()
    const result = await syncQueuedMemberDelete({
      performDelete: vi.fn().mockResolvedValue({ data: true, error: null }),
      readMember
    })

    expect(result).toEqual({ action: 'remove', confirmedBy: 'rpc' })
    expect(readMember).not.toHaveBeenCalled()
  })

  it('keeps the queue when the server may have succeeded but the client receives a transient failure', async () => {
    const readMember = vi.fn()
    await expect(syncQueuedMemberDelete({
      performDelete: vi.fn().mockResolvedValue({ data: null, error: networkError }),
      readMember
    })).rejects.toEqual(networkError)
    expect(readMember).not.toHaveBeenCalled()
  })

  it('retires only a zero-row retry verified as already soft-deleted', async () => {
    const result = await syncQueuedMemberDelete({
      performDelete: vi.fn().mockResolvedValue({ data: null, error: noRowsError }),
      readMember: vi.fn().mockResolvedValue({
        data: [{ id: 'member-1', deleted_at: '2026-09-03T10:00:00.000Z' }],
        error: null
      })
    })

    expect(result).toEqual({
      action: 'remove',
      confirmedBy: 'read',
      deletedAt: '2026-09-03T10:00:00.000Z'
    })
  })

  it('keeps a zero-row retry when the authorized verification shows an active row', async () => {
    const result = await syncQueuedMemberDelete({
      performDelete: vi.fn().mockResolvedValue({ data: null, error: noRowsError }),
      readMember: vi.fn().mockResolvedValue({ data: [{ id: 'member-1', deleted_at: null }], error: null })
    })

    expect(result.action).toBe('fail')
    expect(result.error).toMatch(/still active/i)
  })

  it('keeps the queue when read verification is offline', async () => {
    await expect(syncQueuedMemberDelete({
      performDelete: vi.fn().mockResolvedValue({ data: null, error: noRowsError }),
      readMember: vi.fn().mockResolvedValue({ data: null, error: networkError })
    })).rejects.toEqual(networkError)
  })

  it('keeps authorization failures recoverable and never attempts a verification write', async () => {
    const readMember = vi.fn()
    await expect(syncQueuedMemberDelete({
      performDelete: vi.fn().mockResolvedValue({ data: null, error: authError }),
      readMember
    })).rejects.toEqual(authError)
    expect(readMember).not.toHaveBeenCalled()
  })
})
