import { describe, expect, it } from 'vitest'
import { RealDatserConnectionController } from './realDatserConnectivity'

describe('real DatSer Member V2 connectivity bridge', () => {
  it('uses the real forced-offline selection to block backend access and notifies on reconnect', () => {
    const controller = new RealDatserConnectionController()
    const states = []
    const unsubscribe = controller.subscribe((state) => states.push(state))

    expect(controller.isBackendReachable()).toBe(true)
    controller.setConnection({ isOnline: true, offlineMode: 'offline', offlineModeStatus: 'forced-offline' })
    expect(controller.getState()).toBe('DATSER_OFFLINE')
    expect(controller.isBackendReachable()).toBe(false)

    controller.setConnection({ isOnline: true, offlineMode: 'online', offlineModeStatus: 'online' })
    expect(controller.getState()).toBe('ONLINE')
    expect(states).toEqual(['DATSER_OFFLINE', 'ONLINE'])
    unsubscribe()
  })
})
