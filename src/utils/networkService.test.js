import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let nativeListenerCallback = null
const mockRemoveListener = vi.fn()

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web')
  }
}))

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
    addListener: vi.fn(async (event, cb) => {
      nativeListenerCallback = cb
      return { remove: mockRemoveListener }
    })
  }
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() }))
  }
}))

describe('networkService', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    nativeListenerCallback = null
    const { resetNetworkMonitoringForTests } = await import('./networkService')
    await resetNetworkMonitoringForTests()
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

  it('delivers immediate cached status to new subscribers and does not duplicate native listeners', async () => {
    const { Capacitor } = await import('@capacitor/core')
    const { Network } = await import('@capacitor/network')
    Capacitor.isNativePlatform.mockReturnValue(true)
    Capacitor.getPlatform.mockReturnValue('android')
    Network.getStatus.mockResolvedValue({ connected: true, connectionType: 'wifi' })

    const { initNetworkMonitoring } = await import('./networkService')

    const subA = vi.fn()
    const unsubA = initNetworkMonitoring(subA)
    expect(subA).toHaveBeenCalled()
    expect(Network.addListener).toHaveBeenCalledTimes(1)

    // Second subscriber subscribes
    const subB = vi.fn()
    const unsubB = initNetworkMonitoring(subB)
    expect(subB).toHaveBeenCalled()
    // Must NOT have added a second native listener
    expect(Network.addListener).toHaveBeenCalledTimes(1)

    unsubA()
    unsubB()
  })

  it('maintains updates for subscriber B when subscriber A unsubscribes', async () => {
    const { Capacitor } = await import('@capacitor/core')
    Capacitor.isNativePlatform.mockReturnValue(true)
    Capacitor.getPlatform.mockReturnValue('android')

    const { initNetworkMonitoring } = await import('./networkService')

    const subA = vi.fn()
    const subB = vi.fn()

    const unsubA = initNetworkMonitoring(subA)
    const unsubB = initNetworkMonitoring(subB)

    subA.mockClear()
    subB.mockClear()

    // Unsubscribe A
    unsubA()

    // Trigger native network status change
    expect(nativeListenerCallback).toBeDefined()
    nativeListenerCallback({ connected: false, connectionType: 'none' })

    // subA must NOT be called, subB MUST be called
    expect(subA).not.toHaveBeenCalled()
    expect(subB).toHaveBeenCalledWith({ connected: false, connectionType: 'none' })

    unsubB()
  })
})
