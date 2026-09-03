import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { App } from '@capacitor/app'

let cachedStatus = {
  connected: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  connectionType: 'unknown'
}

let isInitialized = false
let nativeListenerHandle = null
let appListenerHandle = null
const listeners = new Set()

export const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export const isAndroidNative = () => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}

export const getNetworkStatus = async () => {
  if (isNativePlatform()) {
    try {
      const status = await Network.getStatus()
      cachedStatus = {
        connected: Boolean(status.connected),
        connectionType: status.connectionType || 'unknown'
      }
      return cachedStatus
    } catch (err) {
      console.warn('[networkService] Capacitor Network.getStatus error, falling back to navigator:', err)
    }
  }

  cachedStatus = {
    connected: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    connectionType: 'unknown'
  }
  return cachedStatus
}

export const getCachedNetworkConnected = () => cachedStatus.connected

const notifyAll = (status) => {
  cachedStatus = status
  listeners.forEach((listener) => {
    try {
      listener(status)
    } catch (err) {
      console.error('[networkService] Listener threw:', err)
    }
  })
}

// Web fallback handlers
const handleOnline = () => {
  if (isNativePlatform()) {
    getNetworkStatus().then(notifyAll).catch(() => {})
  } else {
    notifyAll({ connected: true, connectionType: 'unknown' })
  }
}

const handleOffline = () => {
  if (isNativePlatform()) {
    getNetworkStatus().then(notifyAll).catch(() => {})
  } else {
    notifyAll({ connected: false, connectionType: 'none' })
  }
}

const handleVisibilityChange = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    getNetworkStatus().then(notifyAll).catch(() => {})
  }
}

export const initNetworkMonitoring = (onStatusChange) => {
  if (typeof onStatusChange === 'function') {
    listeners.add(onStatusChange)
    // Deliver current status immediately so new subscriber doesn't have to wait for next change
    try {
      onStatusChange(cachedStatus)
    } catch (err) {
      console.error('[networkService] Listener threw on initial status:', err)
    }
  }

  if (isInitialized) {
    return () => {
      if (typeof onStatusChange === 'function') {
        listeners.delete(onStatusChange)
      }
    }
  }

  isInitialized = true

  // Initial status fetch
  getNetworkStatus().then(notifyAll).catch(() => {})

  if (isNativePlatform()) {
    Network.addListener('networkStatusChange', (status) => {
      notifyAll({
        connected: Boolean(status.connected),
        connectionType: status.connectionType || 'unknown'
      })
    }).then((handle) => {
      nativeListenerHandle = handle
    }).catch((err) => {
      console.warn('[networkService] Failed to add native networkStatusChange listener:', err)
    })

    try {
      App.addListener('appStateChange', (state) => {
        if (state.isActive) {
          getNetworkStatus().then(notifyAll).catch(() => {})
        }
      }).then((handle) => {
        appListenerHandle = handle
      }).catch(() => {})
    } catch {
      // App plugin not available
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  return () => {
    if (typeof onStatusChange === 'function') {
      listeners.delete(onStatusChange)
    }
  }
}

export const resetNetworkMonitoringForTests = async () => {
  listeners.clear()
  isInitialized = false
  if (nativeListenerHandle?.remove) {
    await nativeListenerHandle.remove()
    nativeListenerHandle = null
  }
  if (appListenerHandle?.remove) {
    await appListenerHandle.remove()
    appListenerHandle = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
