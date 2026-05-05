// Round-trips the events-page UI state (filters + scroll positions)
// through sessionStorage so a click into an event detail and back via
// "Back to events" lands the user where they left. Keyed by the view
// they exited from (and date for calendar/day) so a fresh navigation —
// which has no matching key — still starts clean. One-shot consume:
// reading deletes the entry, so refreshing after the restore falls back
// to defaults.

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

export function saveEventsViewState(
  view: EventsView,
  dayKey: string | null,
  snapshot: EventsViewSnapshot,
): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      storageKey(view, dayKey),
      JSON.stringify(snapshot),
    )
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
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    window.sessionStorage.removeItem(key)
    const parsed = JSON.parse(raw) as EventsViewSnapshot
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}
