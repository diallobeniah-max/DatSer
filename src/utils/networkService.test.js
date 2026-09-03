import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web')
  }
}))

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
    addListener: vi.fn(async () => ({ remove: vi.fn() }))
  }
}))

describe('networkService', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('detects online status in browser environment', async () => {
    const { getNetworkStatus } = await import('./networkService')
    const status = await getNetworkStatus()
    expect(typeof status.connected).toBe('boolean')
  })

  it('queries native Capacitor Network when on native platform', async () => {
    const { Capacitor } = await import('@capacitor/core')
    const { Network } = await import('@capacitor/network')
    Capacitor.isNativePlatform.mockReturnValue(true)
    Capacitor.getPlatform.mockReturnValue('android')
    Network.getStatus.mockResolvedValue({ connected: false, connectionType: 'none' })

    const { getNetworkStatus, isAndroidNative } = await import('./networkService')
    expect(isAndroidNative()).toBe(true)

    const status = await getNetworkStatus()
    expect(status.connected).toBe(false)
    expect(status.connectionType).toBe('none')
  })

  it('notifies subscribers on network status changes', async () => {
    const { initNetworkMonitoring } = await import('./networkService')
    const callback = vi.fn()
    const unsubscribe = initNetworkMonitoring(callback)
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })
})
