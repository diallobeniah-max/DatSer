// The real DatSer connection selector is the only source for Member V2's
// local-development connectivity. This controller intentionally lives in the
// browser module graph: each browser tab gets its own offline state, so one
// test client cannot accidentally pause another client's sync.
export class RealDatserConnectionController {
  constructor() {
    this.connection = { isOnline: true, offlineMode: 'auto', offlineModeStatus: 'online' }
    this.listeners = new Set()
  }

  isBackendReachable() {
    const { isOnline, offlineMode, offlineModeStatus } = this.connection
    return Boolean(isOnline)
      && offlineMode !== 'offline'
      && !['offline', 'forced-offline', 'online-unavailable'].includes(offlineModeStatus)
  }

  getState() {
    return this.isBackendReachable() ? 'ONLINE' : 'DATSER_OFFLINE'
  }

  setConnection({ isOnline, offlineMode, offlineModeStatus } = {}) {
    const next = {
      isOnline: Boolean(isOnline),
      offlineMode: offlineMode || 'auto',
      offlineModeStatus: offlineModeStatus || 'online-unavailable',
    }
    const changed = Object.keys(next).some((key) => next[key] !== this.connection[key])
    if (!changed) return this.getState()
    this.connection = next
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
    return state
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

let controller = null

export const getRealDatserMemberV2Connectivity = () => {
  if (!controller) controller = new RealDatserConnectionController()
  return controller
}

export const setRealDatserMemberV2Connection = (connection) => (
  getRealDatserMemberV2Connectivity().setConnection(connection)
)

export const resetRealDatserMemberV2ConnectivityForTests = () => {
  controller = null
}
