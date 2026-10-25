import { describe, expect, it, vi } from 'vitest'
import { invalidateRequestScope, peekScopedRequest, runScopedRequest } from './runtimeRequestRegistry'

const pending = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('scoped request invalidation', () => {
  it('does not resurrect an invalidated attendance cache when its request finishes', async () => {
    const old = pending()
    const scope = 'synthetic-owner:August_2026'
    const request = runScopedRequest(scope, 'attendance-reconciliation', () => old.promise)
    invalidateRequestScope(scope, 'attendance-reconciliation')
    old.resolve('old attendance')
    await expect(request).resolves.toBe('old attendance')
    expect(peekScopedRequest(scope, 'attendance-reconciliation')).toBeUndefined()
    const fresh = vi.fn(async () => 'saved attendance')
    await expect(runScopedRequest(scope, 'attendance-reconciliation', fresh)).resolves.toBe('saved attendance')
    expect(fresh).toHaveBeenCalledTimes(1)
    invalidateRequestScope(scope)
  })

  it.each(['resolve', 'reject'])('keeps the replacement cache when an invalidated request later %ss', async (outcome) => {
    const old = pending()
    const scope = 'synthetic-replacement:August_2026'
    const request = runScopedRequest(scope, 'attendance-reconciliation', () => old.promise)
    invalidateRequestScope(scope, 'attendance-reconciliation')
    await runScopedRequest(scope, 'attendance-reconciliation', async () => 'saved attendance')
    if (outcome === 'resolve') { old.resolve('old attendance'); await request }
    else { old.reject(new Error('old failure')); await expect(request).rejects.toThrow('old failure') }
    expect(peekScopedRequest(scope, 'attendance-reconciliation')).toBe('saved attendance')
    invalidateRequestScope(scope)
  })
})
