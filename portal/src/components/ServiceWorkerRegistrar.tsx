"use client"

import { useEffect } from "react"

async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return
  }
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
}

/**
 * Registers the PWA service worker for portal routes only (mounted from
 * portal/layout.tsx). Production-only so the SW's caching never interferes
 * with the dev server's HMR. Unregisters on unmount so checkout and other
 * routes never keep an active service worker.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {})
    }

    if (document.readyState === "complete") register()
    else window.addEventListener("load", register)

    return () => {
      window.removeEventListener("load", register)
      void unregisterServiceWorkers()
    }
  }, [])

  return null
}
