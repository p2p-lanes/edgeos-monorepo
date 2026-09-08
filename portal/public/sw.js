// Public static assets only. HTML, RSC and API traffic must never be handled
// here, even when an upstream response accidentally omits Cache-Control.

const CACHE = "edge-portal-static-v2"
let privateCachesRetired = false

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("edge-portal-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => {
        privateCachesRetired = true
        return self.clients.claim()
      }),
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PORTAL_STATIC_CACHE_READY") return
  // A restarted worker may not receive activate. Repeat the idempotent cleanup
  // before acknowledging so readiness never relies on worker-global persistence.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("edge-portal-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => {
        privateCachesRetired = true
        event.ports[0]?.postMessage({
          type: "PORTAL_STATIC_CACHE_READY",
          version: 2,
        })
      }),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (
    request.method !== "GET" ||
    request.mode === "navigate" ||
    !privateCachesRetired
  )
    return

  const url = new URL(request.url)
  if (
    url.origin !== self.location.origin ||
    url.search ||
    request.headers.has("RSC") ||
    request.headers.has("Next-Router-State-Tree")
  )
    return
  const publicStatic =
    /^\/_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?)$/.test(
      url.pathname,
    ) || /^\/icons\/icon(?:-192|-512)?\.png$/.test(url.pathname)
  if (!publicStatic) return
  if (
    request.headers.get("accept")?.includes("text/html") ||
    request.headers.get("accept")?.includes("text/x-component")
  )
    return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache a copy of successful, basic responses for offline fallback.
        if (
          response?.ok &&
          response.type === "basic" &&
          !/private|no-store/i.test(
            response.headers.get("cache-control") || "",
          ) &&
          !/text\/html|text\/x-component/i.test(
            response.headers.get("content-type") || "",
          )
        ) {
          const copy = response.clone()
          caches
            .open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {})
        }
        return response
      })
      .catch(async () => (await caches.match(request)) || Response.error()),
  )
})
