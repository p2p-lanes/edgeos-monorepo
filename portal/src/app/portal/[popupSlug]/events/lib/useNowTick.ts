"use client"

import { useEffect, useState } from "react"

/**
 * A `Date` that re-renders the caller on a fixed interval.
 *
 * Anything derived from "now" (the list's NOW divider, the day grid's red
 * rule, the LIVE badge) goes stale the moment it is painted, so every surface
 * that shows one needs a ticker. One minute is the resolution the calendar
 * displays, so a faster tick would only burn renders; the trade is that a
 * badge can lag reality by up to `intervalMs`.
 */
export function useNowTick(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
