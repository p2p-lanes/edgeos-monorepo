// Minimal service worker: makes the portal installable and lets the app
// shell load when offline. Network-first so online users always get fresh
// content; the cache is only a fallback. Scoped to same-origin GETs, so
// cross-origin API calls to the backend are never intercepted or cached.

const CACHE = "edge-portal-v1"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache a copy of successful, basic responses for offline fallback.
        if (response?.ok && response.type === "basic") {
          const copy = response.clone()
          caches
            .open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {})
        }
        return response
      })
      .catch(() => caches.match(request)),
  )
})
