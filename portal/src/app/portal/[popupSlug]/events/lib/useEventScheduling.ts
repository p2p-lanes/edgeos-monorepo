"use client"

import { useMemo, useState } from "react"

export type DurationUnit = "minutes" | "hours"

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
  const guess = Date.UTC(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  )
  const offsetMin = Math.round((asUtc - guess) / 60000)
  return guess - offsetMin * 60_000
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
  durationValue: number
  setDurationValue: (next: number) => void
  durationUnit: DurationUnit
  setDurationUnit: (next: DurationUnit) => void
  startIso: string
  endIso: string
  durationMinutes: number
}

function pickInitialDuration(initial?: number): {
  value: number
  unit: DurationUnit
} {
  const minutes = Math.max(1, Math.round(initial ?? 60))
  if (minutes >= 60 && minutes % 60 === 0) {
    return { value: minutes / 60, unit: "hours" }
  }
  return { value: minutes, unit: "minutes" }
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
  const initialDuration = pickInitialDuration(initialDurationMinutes)
  const [durationValue, setDurationValue] = useState<number>(
    () => initialDuration.value,
  )
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(
    () => initialDuration.unit,
  )

  const durationMinutes = Math.max(
    1,
    Math.round(durationUnit === "hours" ? durationValue * 60 : durationValue),
  )

  const startIso = useMemo(() => {
    if (!dateStr || !timeStr) return ""
    const ms = combineDateTimeInTz(dateStr, timeStr, displayTz)
    return Number.isNaN(ms) ? "" : new Date(ms).toISOString()
  }, [dateStr, timeStr, displayTz])

  const endIso = useMemo(() => {
    if (!startIso) return ""
    const start = Date.parse(startIso)
    if (Number.isNaN(start)) return ""
    return new Date(start + durationMinutes * 60_000).toISOString()
  }, [startIso, durationMinutes])

  return {
    dateStr,
    setDateStr,
    timeStr,
    setTimeStr,
    durationValue,
    setDurationValue,
    durationUnit,
    setDurationUnit,
    startIso,
    endIso,
    durationMinutes,
  }
}
