import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'

let cachedStatus = {
  connected: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  connectionType: 'unknown'
}

let isInitialized = false
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

export const initNetworkMonitoring = (onStatusChange) => {
  if (typeof onStatusChange === 'function') {
    listeners.add(onStatusChange)
  }

  if (isInitialized) {
    return () => {
      listeners.delete(onStatusChange)
    }
  }

  isInitialized = true

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

  // Initial fetch
  getNetworkStatus().then(notifyAll).catch(() => {})

  if (isNativePlatform()) {
    Network.addListener('networkStatusChange', (status) => {
      notifyAll({
        connected: Boolean(status.connected),
        connectionType: status.connectionType || 'unknown'
      })
    }).catch((err) => {
      console.warn('[networkService] Failed to add native networkStatusChange listener:', err)
    })
  }

  // Web fallback events
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

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  }

  return () => {
    if (typeof onStatusChange === 'function') {
      listeners.delete(onStatusChange)
    }
  }
}
