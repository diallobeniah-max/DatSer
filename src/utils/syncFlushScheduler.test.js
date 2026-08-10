import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncFlushScheduler } from './syncFlushScheduler'

describe('sync flush scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the flush once when triggered', async () => {
    const run = vi.fn().mockResolvedValue('ok')
    const scheduler = createSyncFlushScheduler({ run, minDelayMs: 1200 })
    const result = scheduler.schedule()
    expect(result.scheduled).toBe(true)
    expect(result.delay).toBe(1200)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1200)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('two flush triggers cannot create overlapping duplicate flushes', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const run = vi.fn().mockImplementation(() => gate)
    const scheduler = createSyncFlushScheduler({ run, minDelayMs: 1200 })

    expect(scheduler.schedule().scheduled).toBe(true)
    expect(scheduler.schedule().reason).toBe('already-scheduled')
    expect(scheduler.isPending()).toBe(true)

    await vi.advanceTimersByTimeAsync(1200)
    expect(run).toHaveBeenCalledTimes(1)
    expect(scheduler.schedule().reason).toBe('in-flight')

    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(scheduler.isPending()).toBe(false)
    expect(scheduler.schedule().scheduled).toBe(true)
    await vi.advanceTimersByTimeAsync(1200)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('delays a flush by the requested backoff delay', async () => {
    const run = vi.fn().mockResolvedValue('ok')
    const scheduler = createSyncFlushScheduler({ run, minDelayMs: 1200 })
    scheduler.schedule(55_000)
    await vi.advanceTimersByTimeAsync(54_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('clamps delays to the configured bounds', () => {
    const run = vi.fn()
    const low = createSyncFlushScheduler({ run, minDelayMs: 1200, maxDelayMs: 5000 })
    const high = createSyncFlushScheduler({ run, minDelayMs: 1200, maxDelayMs: 5000 })
    expect(low.schedule(50).delay).toBe(1200)
    expect(high.schedule(900_000).delay).toBe(5000)
  })

  it('a failed flush does not block later schedules', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    const scheduler = createSyncFlushScheduler({ run, minDelayMs: 1200 })
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1200)
    await vi.advanceTimersByTimeAsync(0)
    expect(scheduler.isPending()).toBe(false)
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1200)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancel prevents a scheduled flush from running', async () => {
    const run = vi.fn()
    const scheduler = createSyncFlushScheduler({ run, minDelayMs: 1200 })
    scheduler.schedule()
    scheduler.cancel()
    expect(scheduler.isPending()).toBe(false)
    await vi.advanceTimersByTimeAsync(1200)
    expect(run).not.toHaveBeenCalled()
  })
})
