import { describe, expect, it, vi } from 'vitest'
import { createResumeSyncCoordinator } from './appResumeSync'

describe('createResumeSyncCoordinator', () => {
  it('groups six rapid lifecycle events into one background refresh', async () => {
    let release
    const refresh = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const coordinator = createResumeSyncCoordinator({ refresh, now: () => 1000 })
    const runs = ['focus', 'visible', 'pageshow', 'online', 'focus', 'visible'].map((source) => coordinator.trigger(source))
    expect(refresh).toHaveBeenCalledTimes(1)
    release({ success: true })
    await Promise.all(runs)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('uses a cooldown after a completed refresh', async () => {
    let time = 1000
    const refresh = vi.fn(async () => ({ success: true }))
    const coordinator = createResumeSyncCoordinator({ refresh, now: () => time, cooldownMs: 1500 })
    await coordinator.trigger('focus')
    time = 1200
    expect(await coordinator.trigger('visible')).toEqual({ skipped: 'cooldown' })
    time = 2600
    await coordinator.trigger('pageshow')
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('skips refreshes when document is hidden and marks pending visible refresh', async () => {
    let visibility = 'hidden'
    let time = 1000
    const refresh = vi.fn(async () => ({ success: true }))
    const coordinator = createResumeSyncCoordinator({
      refresh,
      now: () => time,
      cooldownMs: 15000,
      getVisibilityState: () => visibility
    })
    expect(await coordinator.trigger('interval')).toEqual({ skipped: 'hidden' })
    expect(await coordinator.trigger('online', { force: true })).toEqual({ skipped: 'hidden' })
    expect(refresh).not.toHaveBeenCalled()
    expect(coordinator.hasPendingVisibleRefresh()).toBe(true)

    // When document becomes visible, exactly ONE refresh runs immediately (not blocked by cooldown)
    visibility = 'visible'
    time = 2000 // Only 2 seconds later (normally within 15s cooldown)
    await coordinator.trigger('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(coordinator.hasPendingVisibleRefresh()).toBe(false)

    // Subsequent rapid visible events within cooldown are protected by cooldown
    time = 3000
    expect(await coordinator.trigger('focus')).toEqual({ skipped: 'cooldown' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('coalesces multiple hidden events into a single visible refresh', async () => {
    let visibility = 'hidden'
    let time = 1000
    const refresh = vi.fn(async () => ({ success: true }))
    const coordinator = createResumeSyncCoordinator({
      refresh,
      now: () => time,
      cooldownMs: 15000,
      getVisibilityState: () => visibility
    })

    await coordinator.trigger('online', { force: true })
    await coordinator.trigger('pageshow')
    await coordinator.trigger('focus')
    await coordinator.trigger('interval')
    expect(refresh).not.toHaveBeenCalled()
    expect(coordinator.hasPendingVisibleRefresh()).toBe(true)

    visibility = 'visible'
    time = 4000
    await coordinator.trigger('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
