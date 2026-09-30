import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'

let initialized = false
let status = { connected: typeof navigator === 'undefined' || navigator.onLine !== false, connectionType: 'unknown' }
const listeners = new Set()
const native = () => { try { return Capacitor.isNativePlatform() } catch { return false } }
const notify = (next) => { status = { connected: Boolean(next.connected), connectionType: next.connectionType || 'unknown' }; listeners.forEach((listener) => listener(status)) }
const refresh = async () => { if (!native()) return notify({ connected: typeof navigator === 'undefined' || navigator.onLine !== false }); try { notify(await Network.getStatus()) } catch { notify({ connected: typeof navigator === 'undefined' || navigator.onLine !== false }) } }

// This feeds the existing app and Member V2 connectivity model only. It owns
// no mutation queue and never performs a direct backend write.
export const initNetworkMonitoring = (listener) => {
  if (listener) { listeners.add(listener); listener(status) }
  if (initialized) return () => listeners.delete(listener)
  initialized = true
  void refresh()
  if (native()) {
    void Network.addListener('networkStatusChange', notify)
    void App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh() })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh() })
  }
  return () => listeners.delete(listener)
}
