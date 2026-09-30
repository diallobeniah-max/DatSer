import { Capacitor } from '@capacitor/core'

const nativeCachePrefix = 'datser-offline-'
const removeNativeBrowserShell = () => {
  navigator.serviceWorker?.getRegistrations?.().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))).catch(() => {})
  window.caches?.keys?.().then((keys) => Promise.all(keys.filter((key) => key.startsWith(nativeCachePrefix)).map((key) => window.caches.delete(key)))).catch(() => {})
}

export const registerServiceWorker = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  if (Capacitor.isNativePlatform()) {
    removeNativeBrowserShell()
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
