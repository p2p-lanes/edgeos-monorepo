// Round-trips the events-page UI state (filters + scroll positions)
// through sessionStorage so a click into an event detail and back via
// "Back to events" lands the user where they left. Keyed by the view
// they exited from (and date for calendar/day) so a fresh navigation —
// which has no matching key — still starts clean. The first
// `consumeEventsViewState` call removes the sessionStorage entry but
// caches the value in a module-level Map so React StrictMode's
// dev-only double-mount still sees the same snapshot on the second
// (visible) mount; refreshing the page reloads the module and clears
// the cache, so a refresh after restore falls back to defaults.

import type { EventsView } from "./toolbar/types"

const STORAGE_PREFIX = "edgeos:events-state"

export interface EventsScrollSnapshot {
  outer?: number
  innerVertical?: number
  innerHorizontal?: number
}

export interface EventsListFilters {
  search: string
  rsvpedOnly: boolean
  mineOnly: boolean
  showHidden: boolean
  selectedTags: string[]
  selectedTrackIds: string[]
}

export interface EventsViewSnapshot {
  scroll?: EventsScrollSnapshot
  listFilters?: EventsListFilters
}

function storageKey(view: EventsView, dayKey: string | null): string {
  return dayKey
    ? `${STORAGE_PREFIX}:${view}:${dayKey}`
    : `${STORAGE_PREFIX}:${view}`
}

// Module-level cache keyed by (view, dayKey). React StrictMode in
// development mounts → unmounts → remounts client components, so a naive
// "read + remove from sessionStorage" loses the snapshot on the second
// (visible) mount. We cache the consumed snapshot here so all mounts in
// the same browser session see the same value. `saveEventsViewState`
// invalidates the cache so a fresh save isn't shadowed by a stale entry.
const consumedSnapshotCache = new Map<string, EventsViewSnapshot | null>()

export function saveEventsViewState(
  view: EventsView,
  dayKey: string | null,
  snapshot: EventsViewSnapshot,
): void {
  if (typeof window === "undefined") return
  const key = storageKey(view, dayKey)
  consumedSnapshotCache.delete(key)
  try {
    window.sessionStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // QuotaExceeded / private mode — silently drop; missing the restore
    // is recoverable.
  }
}

export function consumeEventsViewState(
  view: EventsView,
  dayKey: string | null,
): EventsViewSnapshot | null {
  if (typeof window === "undefined") return null
  const key = storageKey(view, dayKey)
  if (consumedSnapshotCache.has(key)) {
    return consumedSnapshotCache.get(key) ?? null
  }
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) {
      consumedSnapshotCache.set(key, null)
      return null
    }
    window.sessionStorage.removeItem(key)
    const parsed = JSON.parse(raw) as EventsViewSnapshot
    const value = parsed && typeof parsed === "object" ? parsed : null
    consumedSnapshotCache.set(key, value)
    return value
  } catch {
    return null
  }
}
