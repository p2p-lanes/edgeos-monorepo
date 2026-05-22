/**
 * Render a human-readable summary of an RFC 5545 recurrence rule. Returns
 * null when the rule is missing or its FREQ is not understood.
 */

const WEEKDAY_LABELS: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
}

export function summarizeRrule(
  rrule: string | null | undefined,
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
    base = interval === 1 ? "Repeats daily" : `Repeats every ${interval} days`
  } else if (kv.FREQ === "WEEKLY") {
    const byDay = (kv.BYDAY ?? "")
      .split(",")
      .map((c) => WEEKDAY_LABELS[c.toUpperCase()])
      .filter(Boolean)
    const every = interval === 1 ? "weekly" : `every ${interval} weeks`
    base =
      byDay.length > 0
        ? `Repeats ${every} on ${byDay.join(", ")}`
        : `Repeats ${every}`
  } else if (kv.FREQ === "MONTHLY") {
    base =
      interval === 1 ? "Repeats monthly" : `Repeats every ${interval} months`
  } else {
    return null
  }
  if (kv.COUNT) {
    base += `, for ${kv.COUNT} occurrences`
  } else if (kv.UNTIL) {
    const raw = kv.UNTIL.replace("Z", "")
    if (raw.length >= 8) {
      const y = raw.slice(0, 4)
      const m = raw.slice(4, 6)
      const d = raw.slice(6, 8)
      base += `, until ${y}-${m}-${d}`
    }
  }
  return base
}
