import type { EventStatus } from "@/client"

// Active Events preset: todo lo vigente, sin estados terminales.
export const ACTIVE_EXCLUDED_STATUSES: EventStatus[] = ["cancelled", "rejected"]

/**
 * A status filter key: a real {@link EventStatus}, the `"active"` preset
 * (everything live, terminal statuses excluded), or `"all"` (no status filter).
 * `undefined` means the default = the "Active Events" preset.
 */
export type EventStatusFilter = EventStatus | "active" | "all"

const REAL_EVENT_STATUSES: EventStatus[] = [
  "draft",
  "published",
  "cancelled",
  "pending_approval",
  "rejected",
]

// Accepts real statuses plus the preset ("active") and explicit no-filter
// ("all") sentinels, so shared URLs like ?status=all / ?status=active validate.
export const VALID_EVENT_STATUS_FILTERS: Set<string> = new Set([
  ...REAL_EVENT_STATUSES,
  "active",
  "all",
])

/**
 * Translates a status filter key into the backend query params. `undefined`
 * (or `"active"`) resolves to the default "Active Events" preset, which
 * excludes terminal statuses instead of narrowing to a single one.
 */
export function resolveStatusFilter(status: EventStatusFilter | undefined): {
  eventStatus: EventStatus | undefined
  excludeStatuses: EventStatus[] | undefined
} {
  const effective = status ?? "active"
  return {
    eventStatus:
      effective === "active" || effective === "all" ? undefined : effective,
    excludeStatuses:
      effective === "active" ? ACTIVE_EXCLUDED_STATUSES : undefined,
  }
}
