"use client"

import { localTzNaiveToUtc } from "@edgeos/shared-events"
import { useMemo, useState } from "react"
import {
  type DurationDraft,
  type DurationError,
  draftFromMinutes,
  parseDurationDraft,
} from "./eventDuration"

const DEFAULT_DURATION_MINUTES = 60

/** "YYYY-MM-DD" of today in the given TZ. */
export function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/**
 * Convert a "YYYY-MM-DD" date + "HH:mm" time (interpreted in `tz`) to a UTC
 * instant (ms since epoch). Returns NaN if invalid.
 */
export function combineDateTimeInTz(
  dateStr: string,
  hhmm: string,
  tz: string,
): number {
  if (!dateStr || !hhmm) return Number.NaN
  const [y, mo, d] = dateStr.split("-").map(Number)
  const [h, mi] = hhmm.split(":").map(Number)
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return Number.NaN
  return localTzNaiveToUtc(`${dateStr}T${hhmm}`, tz).getTime()
}

/** Format a Date as "HH:mm" in the given timezone. */
export function formatHhmmInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("hour")}:${get("minute")}`
}

/** Format a Date as "YYYY-MM-DD" in the given timezone. */
export function formatDateKeyInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

interface UseEventSchedulingOptions {
  displayTz: string
  initialDateStr?: string
  initialTimeStr?: string
  initialDurationMinutes?: number
}

export interface UseEventSchedulingResult {
  dateStr: string
  setDateStr: (next: string) => void
  timeStr: string
  setTimeStr: (next: string) => void
  /** Raw Hours / Minutes input text. */
  durationDraft: DurationDraft
  setDurationDraft: (next: DurationDraft) => void
  startIso: string
  /** Empty while the start or the duration is invalid. */
  endIso: string
  /** Total duration in minutes, or null while the draft is invalid. */
  durationMinutes: number | null
  durationError: DurationError | null
}

/**
 * Owns date/time/duration state, derives startIso/endIso/durationMinutes in
 * the popup timezone. The single source of truth for an event-form's
 * scheduling inputs.
 */
export function useEventScheduling(
  options: UseEventSchedulingOptions,
): UseEventSchedulingResult {
  const { displayTz, initialDateStr, initialTimeStr, initialDurationMinutes } =
    options

  // Defaults are seeded once via lazy state initialisers. After that, the
  // setters are the only way state changes — callers wanting to re-hydrate
  // (e.g. when an event loads on the edit page) call setDateStr/setTimeStr
  // explicitly.
  const [dateStr, setDateStr] = useState<string>(
    () => initialDateStr ?? todayInTz(displayTz),
  )
  const [timeStr, setTimeStr] = useState<string>(() => {
    if (initialTimeStr) return initialTimeStr
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 2)
    return formatHhmmInTz(d, displayTz)
  })
  const [durationDraft, setDurationDraft] = useState<DurationDraft>(() =>
    draftFromMinutes(initialDurationMinutes ?? DEFAULT_DURATION_MINUTES),
  )

  // Invalid input stays invalid (null + an error code) instead of being
  // clamped to 1 minute, so the form can show why it can't be submitted.
  const parsedDuration = parseDurationDraft(durationDraft)
  const durationMinutes = parsedDuration.ok ? parsedDuration.minutes : null
  const durationError = parsedDuration.ok ? null : parsedDuration.error

  const startIso = useMemo(() => {
    if (!dateStr || !timeStr) return ""
    const ms = combineDateTimeInTz(dateStr, timeStr, displayTz)
    return Number.isNaN(ms) ? "" : new Date(ms).toISOString()
  }, [dateStr, timeStr, displayTz])

  const endIso = useMemo(() => {
    if (!startIso || durationMinutes == null) return ""
    const start = Date.parse(startIso)
    if (Number.isNaN(start)) return ""
    return new Date(start + durationMinutes * 60_000).toISOString()
  }, [startIso, durationMinutes])

  return {
    dateStr,
    setDateStr,
    timeStr,
    setTimeStr,
    durationDraft,
    setDurationDraft,
    startIso,
    endIso,
    durationMinutes,
    durationError,
  }
}
