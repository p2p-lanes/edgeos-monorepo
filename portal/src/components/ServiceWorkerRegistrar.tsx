"use client"

import { useEffect } from "react"
import { ensureSafeServiceWorker } from "@/lib/service-worker"

/**
 * Retire existing unsafe workers on every entry surface. Installing the optional
 * static worker in a clean browser is best effort, not an authentication gate.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void ensureSafeServiceWorker()
      .then(async () => {
        if (
          process.env.NODE_ENV === "production" &&
          "serviceWorker" in navigator
        ) {
          await navigator.serviceWorker.register("/sw.js", {
            scope: "/",
            updateViaCache: "none",
          })
        }
      })
      .catch(() => {})
  }, [])

  return null
}
