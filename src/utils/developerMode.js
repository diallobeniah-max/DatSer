import { Capacitor } from '@capacitor/core'

export const DEV_BYPASS_STORAGE_KEY = 'datser_dev_bypass'
export const DEV_BYPASS_PREFERENCES_STORAGE_KEY = 'datser_dev_bypass_preferences'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

export const isNativeRuntime = () => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export const isLocalWebDeveloperModeAllowed = () => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  if (isNativeRuntime()) return false
  return LOCAL_HOSTNAMES.has(window.location.hostname)
}

export const clearDeveloperBypassState = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DEV_BYPASS_STORAGE_KEY)
    window.localStorage.removeItem(DEV_BYPASS_PREFERENCES_STORAGE_KEY)
  } catch {
    // Storage may be blocked; nothing else is needed.
  }
}
