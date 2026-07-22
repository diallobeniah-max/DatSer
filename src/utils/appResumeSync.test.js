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
})
