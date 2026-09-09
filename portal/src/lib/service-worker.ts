"use client"

function checkController(controller: ServiceWorker | null): Promise<boolean> {
  if (!controller) return Promise.resolve(false)
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(ready)
    }
    const timer = setTimeout(() => finish(false), 500)
    channel.port1.onmessage = (event) =>
      finish(
        event.data?.type === "PORTAL_STATIC_CACHE_READY" &&
          event.data?.version === 2,
      )
    try {
      controller.postMessage({ type: "PORTAL_STATIC_CACHE_READY" }, [
        channel.port2,
      ])
    } catch {
      channel.port2.close()
      finish(false)
    }
  })
}

/** Await before verify/migrate can issue a cookie, and before session/bootstrap
 * GETs or router.refresh(). Background prefetches may start as soon as a cookie exists.
 * Unregister alone does not retire a worker already controlling this document.
 * No durable flag: every caller verifies the actual current controller.
 */
export async function ensureSafeServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return
  const workers = navigator.serviceWorker
  const initialController = workers.controller
  if (
    (await checkController(initialController)) &&
    workers.controller === initialController
  )
    return
  let timeout: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  try {
    await Promise.race([
      (async () => {
        const registrations = await workers.getRegistrations()
        if (!workers.controller && !registrations.length) return
        const registration = await workers.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        })
        await registration.update()
        while (!stopped) {
          const controller = workers.controller
          if (
            (await checkController(controller)) &&
            workers.controller === controller
          )
            return
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Private cache retirement is not ready")),
          10_000,
        )
      }),
    ])
  } finally {
    stopped = true
    clearTimeout(timeout)
  }
}
