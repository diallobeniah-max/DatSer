// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativePlatform = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: nativePlatform
  }
}))

describe('registerServiceWorker', () => {
  let registerServiceWorker
  let register

  beforeEach(async () => {
    vi.resetModules()
    nativePlatform.mockReset()
    register = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register }
    })
    registerServiceWorker = (await import('./registerServiceWorker')).registerServiceWorker
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('does not register a browser service worker in a native Capacitor shell', () => {
    nativePlatform.mockReturnValue(true)
    const unregister = vi.fn().mockResolvedValue(true)
    const cacheDelete = vi.fn().mockResolvedValue(true)
    navigator.serviceWorker.getRegistrations = vi.fn().mockResolvedValue([{ unregister }])
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: vi.fn().mockResolvedValue(['datser-offline-v3-shell', 'unrelated-cache']),
        delete: cacheDelete
      }
    })

    registerServiceWorker()
    window.dispatchEvent(new Event('load'))

    expect(register).not.toHaveBeenCalled()
    return Promise.resolve().then(() => {
      expect(unregister).toHaveBeenCalledOnce()
      expect(cacheDelete).toHaveBeenCalledWith('datser-offline-v3-shell')
      expect(cacheDelete).not.toHaveBeenCalledWith('unrelated-cache')
    })
  })

  it('registers the PWA worker for a production web build', () => {
    nativePlatform.mockReturnValue(false)
    vi.stubEnv('PROD', true)

    registerServiceWorker()
    window.dispatchEvent(new Event('load'))

    expect(register).toHaveBeenCalledWith('/sw.js')
  })
})
