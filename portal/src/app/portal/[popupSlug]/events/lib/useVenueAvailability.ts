"use client"

import {
  availableStartOptionsForDuration,
  dayBoundsInTz,
  durationFits,
  freeIntervalsForDay,
  type SlotOption,
} from "@edgeos/shared-events"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  EventsService,
  type EventVenuePublic,
  EventVenuesService,
} from "@/client"
import { todayInTz } from "./useEventScheduling"

type Availability = "idle" | "checking" | "ok" | "conflict"

interface UseVenueAvailabilityOptions {
  popupId: string | undefined
  venueId: string
  dateStr: string
  displayTz: string
  startIso: string
  endIso: string
  durationMinutes: number
  /**
   * When set, the availability check passes `exclude_event_id` so the event
   * being edited does not conflict with itself. Backend also enforces this
   * defence-in-depth on the PATCH route.
   */
  excludeEventId?: string
  /** Required for the "snap to first open day in window" effect. */
  isDateOutsidePopupWindow?: (d: Date) => boolean
  popupStartKey?: string | null
  /** Setters allow the hook to snap state when the venue changes. */
  setDateStr?: (next: string) => void
  setTimeStr?: (next: string) => void
}

export interface UseVenueAvailabilityResult {
  venues: EventVenuePublic[]
  selectedVenue: EventVenuePublic | undefined
  isVenueClosedOnDay: ((date: Date) => boolean) | undefined
  selectedDateIsClosed: boolean
  startOptions: ReturnType<typeof availableStartOptionsForDuration>
  /**
   * Up to 3 bookable starts closest to the user's current pick. Surfaced so
   * the form can offer one-click alternatives when the chosen time is in
   * conflict or outside open hours.
   */
  nearbyStartOptions: SlotOption[]
  withinOpenHours: boolean
  availability: Availability
  availabilityData:
    | Awaited<ReturnType<typeof EventVenuesService.getPortalAvailability>>
    | undefined
}

/**
 * Owns the venue list, per-day open-hours availability, and the debounced
 * conflict check. Designed so create and edit can share the exact same UX.
 */
export function useVenueAvailability(
  options: UseVenueAvailabilityOptions,
): UseVenueAvailabilityResult {
  const {
    popupId,
    venueId,
    dateStr,
    displayTz,
    startIso,
    endIso,
    durationMinutes,
    excludeEventId,
    isDateOutsidePopupWindow,
    popupStartKey,
    setDateStr,
    setTimeStr,
  } = options

  const { data: venuesData } = useQuery({
    queryKey: ["portal-event-venues", popupId],
    queryFn: () =>
      EventVenuesService.listPortalVenues({
        popupId: popupId as string,
        limit: 200,
      }),
    enabled: !!popupId,
  })
  const venues = venuesData?.results ?? []

  const selectedVenue: EventVenuePublic | undefined = useMemo(
    () => venues.find((v) => v.id === venueId),
    [venues, venueId],
  )

  const isVenueClosedOnDay = useMemo(() => {
    const hours = selectedVenue?.weekly_hours
    if (!hours || hours.length === 0) return undefined
    const closedByBackendDay = new Map<number, boolean>()
    for (const h of hours) {
      closedByBackendDay.set(h.day_of_week, h.is_closed)
    }
    return (date: Date) => {
      const backendDay = (date.getDay() + 6) % 7
      const isClosed = closedByBackendDay.get(backendDay)
      return isClosed === undefined || isClosed === true
    }
  }, [selectedVenue])

  const selectedDateIsClosed = useMemo(() => {
    if (!isVenueClosedOnDay || !dateStr) return false
    const [y, m, d] = dateStr.split("-").map(Number)
    if (!y || !m || !d) return false
    return isVenueClosedOnDay(new Date(y, m - 1, d))
  }, [isVenueClosedOnDay, dateStr])

  // When the venue changes, if the current date is closed at the new venue
  // jump to the first open day inside the popup window.
  const prevVenueIdRef = useRef(venueId)
  useEffect(() => {
    if (prevVenueIdRef.current === venueId) return
    prevVenueIdRef.current = venueId
    if (!setDateStr) return
    if (!isVenueClosedOnDay || !dateStr) return
    const [y, m, d] = dateStr.split("-").map(Number)
    if (!y || !m || !d) return
    if (!isVenueClosedOnDay(new Date(y, m - 1, d))) return
    const todayKey = todayInTz(displayTz)
    const startKey =
      popupStartKey && popupStartKey > todayKey ? popupStartKey : todayKey
    const [sy, sm, sd] = startKey.split("-").map(Number)
    if (!sy || !sm || !sd) return
    const cursor = new Date(sy, sm - 1, sd)
    for (let i = 0; i < 400; i++) {
      if (isDateOutsidePopupWindow?.(cursor)) return
      if (!isVenueClosedOnDay(cursor)) {
        const yy = cursor.getFullYear()
        const mm = String(cursor.getMonth() + 1).padStart(2, "0")
        const dd = String(cursor.getDate()).padStart(2, "0")
        setDateStr(`${yy}-${mm}-${dd}`)
        return
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  }, [
    venueId,
    isVenueClosedOnDay,
    isDateOutsidePopupWindow,
    dateStr,
    displayTz,
    popupStartKey,
    setDateStr,
  ])

  const dayBounds = useMemo(() => {
    if (!dateStr) return null
    return dayBoundsInTz(dateStr, displayTz)
  }, [dateStr, displayTz])

  const { data: availabilityData } = useQuery({
    queryKey: [
      "portal-venue-availability",
      venueId,
      dayBounds?.start.toISOString(),
    ],
    queryFn: () =>
      EventVenuesService.getPortalAvailability({
        venueId: venueId,
        start: (dayBounds as { start: Date }).start.toISOString(),
        end: (dayBounds as { end: Date }).end.toISOString(),
      }),
    enabled: !!venueId && !!dayBounds,
  })

  const freeIntervals = useMemo(() => {
    if (!availabilityData || !dayBounds) return []
    return freeIntervalsForDay(
      availabilityData.open_ranges,
      availabilityData.busy,
      dayBounds.start,
      dayBounds.end,
    )
  }, [availabilityData, dayBounds])

  const openOnlyIntervals = useMemo(() => {
    if (!availabilityData || !dayBounds) return []
    return freeIntervalsForDay(
      availabilityData.open_ranges,
      [],
      dayBounds.start,
      dayBounds.end,
    )
  }, [availabilityData, dayBounds])

  const startOptions = useMemo(
    () =>
      availableStartOptionsForDuration(
        freeIntervals,
        durationMinutes,
        30,
        displayTz,
      ),
    [freeIntervals, durationMinutes, displayTz],
  )

  // Snap timeStr to the first available slot once availability has loaded
  // for a newly-selected venue.
  const lastVenueSnapRef = useRef("")
  useEffect(() => {
    if (!setTimeStr) return
    if (!venueId) {
      lastVenueSnapRef.current = ""
      return
    }
    if (lastVenueSnapRef.current === venueId) return
    if (startOptions.length === 0) return
    lastVenueSnapRef.current = venueId
    setTimeStr(startOptions[0].label)
  }, [venueId, startOptions, setTimeStr])

  const nearbyStartOptions = useMemo(() => {
    if (startOptions.length === 0) return []
    const targetMs = startIso ? Date.parse(startIso) : Number.NaN
    const anchor = Number.isFinite(targetMs)
      ? targetMs
      : (dayBounds?.start.getTime() ?? 0)
    return [...startOptions]
      .map((opt) => ({ opt, t: Date.parse(opt.isoUtc) }))
      .sort((a, b) => Math.abs(a.t - anchor) - Math.abs(b.t - anchor))
      .slice(0, 3)
      .sort((a, b) => a.t - b.t)
      .map(({ opt }) => opt)
  }, [startOptions, startIso, dayBounds])

  const withinOpenHours = useMemo(() => {
    if (!venueId) return true
    if (!startIso) return true
    if (openOnlyIntervals.length === 0) return true
    const ms = Date.parse(startIso)
    if (Number.isNaN(ms)) return true
    return durationFits(openOnlyIntervals, ms, durationMinutes)
  }, [venueId, startIso, openOnlyIntervals, durationMinutes])

  const [availability, setAvailability] = useState<Availability>("idle")

  useEffect(() => {
    if (!venueId || !startIso || !endIso) {
      setAvailability("idle")
      return
    }
    const handle = setTimeout(async () => {
      setAvailability("checking")
      try {
        const res = await EventsService.checkAvailabilityPortal({
          requestBody: {
            venue_id: venueId,
            start_time: startIso,
            end_time: endIso,
            ...(excludeEventId ? { exclude_event_id: excludeEventId } : {}),
          },
        })
        setAvailability(res.available ? "ok" : "conflict")
      } catch {
        setAvailability("idle")
      }
    }, 500)
    return () => clearTimeout(handle)
  }, [venueId, startIso, endIso, excludeEventId])

  return {
    venues,
    selectedVenue,
    isVenueClosedOnDay,
    selectedDateIsClosed,
    startOptions,
    nearbyStartOptions,
    withinOpenHours,
    availability,
    availabilityData,
  }
}
