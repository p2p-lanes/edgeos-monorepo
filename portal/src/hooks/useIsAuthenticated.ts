"use client"

import { useSyncExternalStore } from "react"
import { getStoredTokenInfo, type StoredTokenInfo } from "@/lib/auth-token"

function subscribe(callback: () => void) {
  window.addEventListener("auth-change", callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener("auth-change", callback)
    window.removeEventListener("storage", callback)
  }
}

function getSnapshot() {
  return localStorage.getItem("token") !== null
}

function getServerSnapshot() {
  return false
}

export function useIsAuthenticated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function dispatchAuthChange() {
  window.dispatchEvent(new Event("auth-change"))
}

// useSyncExternalStore requires referentially stable snapshots; cache by token
// string so re-reading does not trigger re-render loops.
let cachedTokenInfo: StoredTokenInfo | null = null
function getTokenInfoSnapshot(): StoredTokenInfo | null {
  const next = getStoredTokenInfo()
  if (next?.token === cachedTokenInfo?.token) {
    return cachedTokenInfo
  }
  cachedTokenInfo = next
  return cachedTokenInfo
}

function getTokenInfoServerSnapshot(): StoredTokenInfo | null {
  return null
}

export function useStoredTokenInfo(): StoredTokenInfo | null {
  return useSyncExternalStore(
    subscribe,
    getTokenInfoSnapshot,
    getTokenInfoServerSnapshot,
  )
}
