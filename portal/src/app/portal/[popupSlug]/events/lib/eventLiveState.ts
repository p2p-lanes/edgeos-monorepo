/**
 * Whether an event is in progress at the instant `nowMs`.
 *
 * The window is half-open, `start <= now < end`, so two back-to-back sessions
 * never both read as live during the changeover minute: the one that ends at
 * 21:00 stops being live exactly when the one that starts at 21:00 begins.
 *
 * Both bounds are absolute instants (ISO-8601 with an offset), so the
 * comparison is timezone-agnostic. The popup timezone decides only how those
 * instants are *rendered*; it never changes whether an event is running. That
 * keeps the predicate correct for a viewer sitting in any timezone, which is
 * why this takes raw timestamps instead of going through
 * `useEventTimezone`'s formatters.
 *
 * Returns false for a missing or unparseable timestamp, and for a window that
 * does not move forward (`end <= start`), which is empty by definition.
 */
export function isEventLive(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  nowMs: number,
): boolean {
  if (!startTime || !endTime) return false
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return false
  if (end <= start) return false
  return start <= nowMs && nowMs < end
}
