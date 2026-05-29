export const registerServiceWorker = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const shouldRegister =
    import.meta.env.PROD ||
    window.location.protocol === 'capacitor:'

  if (!shouldRegister) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => {
        console.warn('DatSer service worker registration failed:', error)
      })
  })
}
