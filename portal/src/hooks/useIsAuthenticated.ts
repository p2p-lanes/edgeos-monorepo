"use client"

import { useSyncExternalStore } from "react"

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
