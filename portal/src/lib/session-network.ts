"use client"

import { ensureSafeServiceWorker } from "./service-worker"

// Browser-only request lifetime, never a session/token cache. Rotating it aborts
// old-identity reads and writes, including requests still awaiting the worker.
let lifetime: AbortController | undefined
let paused = false

export function rotateSessionRequests(pause = false): void {
  lifetime?.abort()
  lifetime = new AbortController()
  paused = pause
}

export async function sessionRequestSignal(
  signal?: AbortSignal,
): Promise<AbortSignal> {
  if (typeof window === "undefined")
    throw new Error("Browser API transport is unavailable during SSR")
  lifetime ??= new AbortController()
  const captured = lifetime
  await ensureSafeServiceWorker()
  if (paused || captured.signal.aborted)
    throw new DOMException("Session changed", "AbortError")
  return signal ? AbortSignal.any([signal, captured.signal]) : captured.signal
}

export function notifyInvalidSession(
  status: number,
  upstream: boolean,
  code: unknown,
): void {
  if (status === 401 && !upstream && code === "session_invalid") {
    window.dispatchEvent(new Event("portal:session-invalid"))
  }
}

export async function portalFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!path.startsWith("/api/v1/") || path.includes("\\"))
    throw new Error("Invalid Portal API path")
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: await sessionRequestSignal(init.signal ?? undefined),
  })
  if (
    response.status === 401 &&
    response.headers.get("x-portal-response") !== "upstream"
  ) {
    const body = await response
      .clone()
      .json()
      .catch(() => ({}))
    notifyInvalidSession(response.status, false, body.code)
  }
  return response
}
