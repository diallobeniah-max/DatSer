const CACHE_VERSION = 'datser-offline-v2'
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/app-version.json',
  '/favicon.png',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png'
]

const isSameOrigin = (requestUrl) => requestUrl.origin === self.location.origin

const fetchAndCache = async (request, cacheName) => {
  const response = await fetch(request)
  if (response && response.ok) {
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
  }
  return response
}

const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  return fetchAndCache(request, RUNTIME_CACHE)
}

const networkFirst = async (request, fallbackUrl = '/index.html') => {
  try {
    return await fetchAndCache(request, RUNTIME_CACHE)
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return caches.match(fallbackUrl)
  }
}

const staleWhileRevalidate = async (request) => {
  const cached = await caches.match(request)
  const networkPromise = fetchAndCache(request, RUNTIME_CACHE).catch(() => null)
  return cached || networkPromise || caches.match('/index.html')
}

const cacheBuiltAssetsFromIndex = async (cache) => {
  try {
    const response = await fetch('/index.html', { cache: 'no-store' })
    if (!response?.ok) return
    const html = await response.clone().text()
    await cache.put('/index.html', response)
    const assetUrls = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g))
      .map((match) => match[1])
      .filter((url) => url.startsWith('/assets/') || url.startsWith('./assets/') || url.startsWith('assets/'))
      .map((url) => new URL(url, self.location.origin).pathname)
    await Promise.allSettled([...new Set(assetUrls)].map((url) => cache.add(url)))
  } catch {
    // Runtime caching will still fill this after the app has loaded once.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => caches.open(RUNTIME_CACHE))
      .then((cache) => cacheBuiltAssetsFromIndex(cache))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('datser-offline-') && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const requestUrl = new URL(request.url)

  // Keep protected Supabase/API responses out of Cache Storage. User data is
  // stored in the app's user-bound IndexedDB snapshot instead.
  if (!isSameOrigin(requestUrl)) return

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request, '/index.html'))
    return
  }

  if (
    requestUrl.pathname.startsWith('/assets/') ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|gif|ico|woff2?)$/i.test(requestUrl.pathname)
  ) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (requestUrl.pathname === '/app-version.json') {
    event.respondWith(networkFirst(request, '/app-version.json'))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})
