import { Capacitor } from '@capacitor/core'

const NATIVE_SHELL_CACHE_PREFIX = 'datser-offline-'

const removeLegacyNativeShellCache = () => {
  navigator.serviceWorker
    ?.getRegistrations?.()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => {})

  if (!window.caches?.keys) return

  window.caches
    .keys()
    .then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(NATIVE_SHELL_CACHE_PREFIX))
        .map((key) => window.caches.delete(key))
    ))
    .catch(() => {})
}

export const registerServiceWorker = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  // Native Capacitor builds already ship their own versioned app shell from
  // android/app/src/main/assets/public. Keeping a browser service worker in
  // that WebView can let an older cached shell win after an APK update. The
  // scoped IndexedDB snapshot and mutation queue remain the native offline
  // mechanism; this only avoids stale UI assets in the native shell.
  if (Capacitor.isNativePlatform()) {
    removeLegacyNativeShellCache()
    return
  }

  const shouldRegister = import.meta.env.PROD

  if (!shouldRegister) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => {
        console.warn('DatSer service worker registration failed:', error)
      })
  })
}
