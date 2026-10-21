// Pure duration math for the event form's Hours / Minutes inputs. No React,
// no i18n: the picker component turns these results into user-facing copy.
// The canonical value is always a whole number of minutes; the draft keeps
// the raw text of each input so an invalid entry is reported, never coerced.
// Mirrored in backoffice/src/lib/events/eventDuration.ts
// (keep the two copies in sync).

/** Quick-pick presets (in minutes) shown above the Hours / Minutes fields. */
export const DURATION_PRESETS = [30, 60, 90, 120] as const

/** Raw text of the Hours and Minutes inputs, exactly as typed. */
export interface DurationDraft {
  hours: string
  minutes: string
}

export type DurationError = "required" | "invalid" | "not_positive"

export type DurationParseResult =
  | { ok: true; minutes: number }
  | { ok: false; error: DurationError }

// Hours accept decimals ("1.5" = 90 min); minutes are whole numbers. Both
// reject signs, exponents and anything else `Number()` would quietly accept.
const HOURS_RE = /^\d+(?:\.\d+)?$/
const MINUTES_RE = /^\d+$/

/** Split a total in minutes into whole hours plus the remaining minutes. */
export function splitMinutes(total: number): {
  hours: number
  minutes: number
} {
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

/**
 * Build the input draft for a total in minutes (90 -> "1" h "30" min,
 * 1560 -> "26" h "0" min). A missing or negative total yields empty inputs,
 * which `parseDurationDraft` reports as an error instead of guessing.
 */
export function draftFromMinutes(
  total: number | null | undefined,
): DurationDraft {
  if (total == null || !Number.isFinite(total) || total < 0) {
    return { hours: "", minutes: "" }
  }
  const { hours, minutes } = splitMinutes(Math.round(total))
  return { hours: String(hours), minutes: String(minutes) }
}

/**
 * Validate the Hours / Minutes draft and return the total in minutes. An
 * empty input counts as 0 as long as the other one is filled in.
 */
export function parseDurationDraft(draft: DurationDraft): DurationParseResult {
  const hoursText = draft.hours.trim()
  const minutesText = draft.minutes.trim()
  if (!hoursText && !minutesText) return { ok: false, error: "required" }
  if (hoursText && !HOURS_RE.test(hoursText)) {
    return { ok: false, error: "invalid" }
  }
  if (minutesText && !MINUTES_RE.test(minutesText)) {
    return { ok: false, error: "invalid" }
  }
  const total =
    (hoursText ? Number(hoursText) : 0) * 60 +
    (minutesText ? Number(minutesText) : 0)
  const rounded = Math.round(total)
  // 1.01 h is 60.6 min: refuse it rather than rounding behind the user's back.
  if (Math.abs(total - rounded) > 1e-9) return { ok: false, error: "invalid" }
  if (rounded <= 0) return { ok: false, error: "not_positive" }
  return { ok: true, minutes: rounded }
}

function dateKeyInTz(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function hhmmInTz(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("hour")}:${get("minute")}`
}

export interface EventEnd {
  /** End instant, ms since epoch. */
  endMs: number
  /** Wall-clock "HH:mm" of the end in `timeZone`. */
  time: string
  /** Calendar days between the start and end dates in `timeZone`. */
  dayOffset: number
}

/**
 * Where an event starting at `startMs` and lasting `minutes` ends, expressed
 * in the event timezone. `dayOffset` lets the UI say "next day" (or show the
 * date) for events that cross midnight or last longer than a day.
 */
export function computeEventEnd(
  startMs: number,
  minutes: number,
  timeZone: string,
): EventEnd | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(minutes) || minutes <= 0) {
    return null
  }
  const endMs = startMs + minutes * 60_000
  const startDay = Date.parse(`${dateKeyInTz(startMs, timeZone)}T00:00:00Z`)
  const endDay = Date.parse(`${dateKeyInTz(endMs, timeZone)}T00:00:00Z`)
  return {
    endMs,
    time: hhmmInTz(endMs, timeZone),
    dayOffset: Math.round((endDay - startDay) / 86_400_000),
  }
}
