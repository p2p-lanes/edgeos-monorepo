"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Tracks whether the user has clicked through "Add to calendar" for a
 * given event (or recurring-event occurrence). Persisted in localStorage
 * because clicking a provider link opens an external tab and we have no
 * server callback that confirms the entry was actually saved — so we
 * track *intent*, not state.
 *
 * Returns ``[isAdded, markAdded, markRemoved]``. Callers should fire
 * ``markAdded`` from each provider option in the modal, and surface a
 * ``markRemoved`` affordance so a user who took the event off their
 * calendar can clear the flag and get the regular "Add to calendar"
 * button back.
 */
const STORAGE_PREFIX = "edgeos:cal-added"

function storageKey(eventId: string, occurrenceStart: string | null): string {
  const occ = occurrenceStart ?? "master"
  return `${STORAGE_PREFIX}:${eventId}:${occ}`
}

function readFlag(key: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(key) === "1"
  } catch {
    // Private mode / disabled storage — treat as not-added so the user
    // still sees the action.
    return false
  }
}

export function useCalendarAddedFlag(
  eventId: string | undefined,
  occurrenceStart: string | null,
): [boolean, () => void, () => void] {
  const key = eventId ? storageKey(eventId, occurrenceStart) : null
  const [isAdded, setIsAdded] = useState<boolean>(false)

  // Read once on mount + whenever the key changes (different event /
  // occurrence). SSR returns false; we hydrate after mount.
  useEffect(() => {
    if (!key) {
      setIsAdded(false)
      return
    }
    setIsAdded(readFlag(key))
  }, [key])

  // Cross-tab sync: another tab marking the same event added/removed
  // should reflect here too.
  useEffect(() => {
    if (!key || typeof window === "undefined") return
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setIsAdded(e.newValue === "1")
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [key])

  const markAdded = useCallback(() => {
    if (!key) return
    try {
      window.localStorage.setItem(key, "1")
    } catch {
      // Storage write failed (quota / private mode); fall through and
      // still flip the in-memory flag so the UI updates this session.
    }
    setIsAdded(true)
  }, [key])

  const markRemoved = useCallback(() => {
    if (!key) return
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Same fallback as above.
    }
    setIsAdded(false)
  }, [key])

  return [isAdded, markAdded, markRemoved]
}
