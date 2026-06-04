/**
 * Render a human-readable summary of an RFC 5545 recurrence rule. Returns
 * null when the rule is missing or its FREQ is not understood.
 *
 * Requires an i18next `t` function so the output is translated according to
 * the active locale. All strings are keyed under `events.recurrence.*`.
 */

import type { TFunction } from "i18next"

export function summarizeRrule(
  rrule: string | null | undefined,
  t: TFunction,
): string | null {
  if (!rrule) return null
  const kv: Record<string, string> = {}
  for (const part of rrule.split(";")) {
    const [k, v] = part.split("=")
    if (k && v) kv[k.toUpperCase()] = v
  }
  const interval = parseInt(kv.INTERVAL ?? "1", 10) || 1
  let base = ""
  if (kv.FREQ === "DAILY") {
    base = t("events.recurrence.daily", { count: interval })
  } else if (kv.FREQ === "WEEKLY") {
    const byDay = (kv.BYDAY ?? "")
      .split(",")
      .map((c) => t(`events.recurrence.weekday_${c.toUpperCase()}`))
      .filter(Boolean)
    if (byDay.length > 0) {
      base = t("events.recurrence.weekly_on", {
        count: interval,
        days: byDay.join(", "),
      })
    } else {
      base = t("events.recurrence.weekly", { count: interval })
    }
  } else if (kv.FREQ === "MONTHLY") {
    base = t("events.recurrence.monthly", { count: interval })
  } else {
    return null
  }
  if (kv.COUNT) {
    base += t("events.recurrence.count_suffix", {
      count: parseInt(kv.COUNT, 10),
    })
  } else if (kv.UNTIL) {
    const raw = kv.UNTIL.replace("Z", "")
    if (raw.length >= 8) {
      const y = raw.slice(0, 4)
      const m = raw.slice(4, 6)
      const d = raw.slice(6, 8)
      base += t("events.recurrence.until_suffix", { date: `${y}-${m}-${d}` })
    }
  }
  return base
}
