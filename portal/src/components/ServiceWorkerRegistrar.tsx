"use client"

import { useEffect } from "react"
import { ensureSafeServiceWorker } from "@/lib/service-worker"

/**
 * Update on every entry surface, including checkout and auth. Future auth
 * consumers await the same barrier themselves; this eager call is not a gate.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void ensureSafeServiceWorker().catch(() => {})
  }, [])

  return null
}
