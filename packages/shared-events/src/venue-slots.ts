/**
 * Compute bookable time slots for a venue on a given day, given the venue's
 * open ranges and busy slots (as returned by /event-venues/{id}/availability).
 *
 * The UI uses this to populate two dropdowns (start time, end time) that
 * only offer values the venue is actually available for.
 */

export interface OpenRange {
  /** ISO datetime strings (UTC) from the backend. */
  start: string
  end: string
}

export interface BusySlot extends OpenRange {
  source: string
  label?: string | null
}

export interface SlotOption {
  /** 'HH:mm' in the target display timezone. */
  label: string
  /** ISO datetime in UTC to send to the backend. */
  isoUtc: string
}

interface Interval {
  start: number // ms since epoch
  end: number
}

function toInterval(r: { start: string; end: string }): Interval {
  return { start: Date.parse(r.start), end: Date.parse(r.end) }
}

/**
 * Return the list of free sub-intervals for a given day, expressed as
 * [ms-start, ms-end) pairs. Clips open_ranges to the day and removes any
 * overlap with busy slots.
 *
 * `dayStart` and `dayEnd` delimit the day in the caller's target TZ.
 */
export function freeIntervalsForDay(
  open: OpenRange[],
  busy: BusySlot[],
  dayStart: Date,
  dayEnd: Date,
): Interval[] {
  const dayS = dayStart.getTime()
  const dayE = dayEnd.getTime()

  // Clip open ranges to the day.
  const clipped: Interval[] = []
  for (const r of open) {
    const iv = toInterval(r)
    const s = Math.max(iv.start, dayS)
    const e = Math.min(iv.end, dayE)
    if (s < e) clipped.push({ start: s, end: e })
  }
  if (clipped.length === 0) return []

  // Subtract busy intervals.
  const busyIvs: Interval[] = busy
    .map(toInterval)
    .filter((b) => b.end > dayS && b.start < dayE)
    .map((b) => ({ start: Math.max(b.start, dayS), end: Math.min(b.end, dayE) }))
    .sort((a, b) => a.start - b.start)

  const result: Interval[] = []
  for (const iv of clipped) {
    let cursor = iv.start
    for (const b of busyIvs) {
      if (b.end <= cursor) continue
      if (b.start >= iv.end) break
      if (b.start > cursor) {
        result.push({ start: cursor, end: Math.min(b.start, iv.end) })
      }
      cursor = Math.max(cursor, b.end)
      if (cursor >= iv.end) break
    }
    if (cursor < iv.end) {
      result.push({ start: cursor, end: iv.end })
    }
  }
  return result
}

/**
 * Enumerate timestamps inside `[iv.start, iv.end)` stepped by
 * `stepMinutes`, aligned to step boundaries (HH:00, HH:30 for a 30-min
 * step) so the labels read as clock-friendly times. Any leading partial
 * slot (e.g. when the interval starts at 9:10 because setup/teardown
 * shifted the free window) is skipped — the venue lock still happens
 * setup_time_minutes BEFORE the displayed start.
 */
function stepThrough(iv: Interval, stepMinutes: number): number[] {
  const step = stepMinutes * 60 * 1000
  const aligned = Math.ceil(iv.start / step) * step
  const out: number[] = []
  for (let t = aligned; t < iv.end; t += step) out.push(t)
  return out
}

function formatInTz(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms))
  } catch {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
}

/**
 * Same as availableStartOptions but filtered so that `start + duration`
 * also fits inside the same free interval (i.e. the whole event fits).
 */
export function availableStartOptionsForDuration(
  freeIntervals: Interval[],
  durationMinutes: number,
  stepMinutes: number,
  timeZone: string,
): SlotOption[] {
  const durationMs = Math.max(1, durationMinutes) * 60 * 1000
  const options: SlotOption[] = []
  const seen = new Set<number>()
  for (const iv of freeIntervals) {
    for (const t of stepThrough(iv, stepMinutes)) {
      if (t + durationMs > iv.end) break
      if (seen.has(t)) continue
      seen.add(t)
      options.push({
        label: formatInTz(t, timeZone),
        isoUtc: new Date(t).toISOString(),
      })
    }
  }
  return options.sort((a, b) => Date.parse(a.isoUtc) - Date.parse(b.isoUtc))
}

/** Does `[startMs, startMs + durationMinutes)` fit inside a free interval? */
export function durationFits(
  freeIntervals: Interval[],
  startMs: number,
  durationMinutes: number,
): boolean {
  const end = startMs + durationMinutes * 60 * 1000
  return freeIntervals.some((iv) => startMs >= iv.start && end <= iv.end)
}

/**
 * Valid end-time options given a chosen start time: every step > start
 * that stays within the SAME free interval that contains `startMs`. This
 * prevents an end-time that would span a busy block.
 */
export function availableEndOptions(
  freeIntervals: Interval[],
  startMs: number,
  stepMinutes: number,
  timeZone: string,
): SlotOption[] {
  const containing = freeIntervals.find(
    (iv) => startMs >= iv.start && startMs < iv.end,
  )
  if (!containing) return []
  const step = stepMinutes * 60 * 1000
  const options: SlotOption[] = []
  for (let t = startMs + step; t <= containing.end; t += step) {
    options.push({
      label: formatInTz(t, timeZone),
      isoUtc: new Date(t).toISOString(),
    })
  }
  return options
}

/**
 * Build the [dayStart, dayEnd) interval for the given local-date string
 * ("YYYY-MM-DD") in the supplied timezone. Uses the well-known trick of
 * formatting midnight in the target TZ to find its UTC instant.
 */
export function dayBoundsInTz(
  dateStr: string,
  timeZone: string,
): { start: Date; end: Date } {
  // 'YYYY-MM-DDT00:00:00' interpreted as-if in timeZone:
  const [y, m, d] = dateStr.split("-").map(Number)
  // Build a UTC guess, then adjust by the offset of that moment in tz.
  const guess = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0)
  const offsetMinutes = tzOffsetMinutes(guess, timeZone)
  const start = new Date(guess - offsetMinutes * 60 * 1000)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

/** Minutes east of UTC for the given instant in the timezone. */
function tzOffsetMinutes(ms: number, timeZone: string): number {
  // Parse the wall-clock time in the target TZ and compute its offset.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  )
  return Math.round((asUtc - ms) / 60000)
}
