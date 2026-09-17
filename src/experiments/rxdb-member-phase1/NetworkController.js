const storageKey = 'datser-member-v2-harness-simulated-offline'

const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

// This controller is deliberately per browser tab. sessionStorage survives a
// normal reload but does not put a second harness client into offline mode.
export class NetworkController {
  constructor({ storage = globalThis.sessionStorage, browserOnlineCheck = browserOnline } = {}) {
    this.storage = storage
    this.browserOnlineCheck = browserOnlineCheck
    this.simulatedOffline = this.storage?.getItem(storageKey) === 'true'
    this.listeners = new Set()
  }

  getState() {
    if (this.simulatedOffline) return 'SIMULATED_OFFLINE'
    return this.browserOnlineCheck() ? 'ONLINE' : 'OFFLINE'
  }

  isBackendReachable() {
    return this.getState() === 'ONLINE'
  }

  setSimulatedOffline(value) {
    const next = Boolean(value)
    if (this.simulatedOffline === next) return this.getState()
    this.simulatedOffline = next
    if (next) this.storage?.setItem(storageKey, 'true')
    else this.storage?.removeItem(storageKey)
    this.#notify()
    return this.getState()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notifyBrowserConnectivityChanged() {
    this.#notify()
  }

  #notify() {
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}

export const createMemberV2NetworkController = (options) => new NetworkController(options)
