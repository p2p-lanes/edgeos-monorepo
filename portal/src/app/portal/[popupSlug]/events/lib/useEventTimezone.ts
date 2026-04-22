"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { type EventSettingsPublic, EventSettingsService } from "@/client"

const DEFAULT_TZ =
  (typeof Intl !== "undefined" &&
    Intl.DateTimeFormat().resolvedOptions().timeZone) ||
  "UTC"

/**
 * Single source of truth for the portal-event-settings query. Other hooks
 * and pages should consume this rather than refetching the same endpoint
 * with the same query key.
 */
export function usePortalEventSettings(popupId: string | undefined) {
  return useQuery({
    queryKey: ["portal-event-settings", popupId],
    queryFn: () =>
      EventSettingsService.getPortalEventSettings({
        popupId: popupId as string,
      }) as Promise<EventSettingsPublic | null>,
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Returns a popup's configured timezone along with reusable formatters.
 * Falls back to the browser timezone when settings are missing.
 */
export function useEventTimezone(popupId: string | undefined) {
  const { data: settings, isLoading } = usePortalEventSettings(popupId)

  const timezone = settings?.timezone || DEFAULT_TZ

  return useMemo(() => {
    const formatTime = (dateStr: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(dateStr))

    const formatDateShort = (dateStr: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date(dateStr))

    const formatDateFull = (dateStr: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(dateStr))

    // YYYY-MM-DD in the popup's timezone (for grouping/keying by day).
    const formatDayKey = (dateStr: string) => {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(dateStr))
    }

    // YYYY-MM-DD from a nominal local Date (no timezone conversion).
    // Used for matching calendar grid cells against event day-keys.
    const formatGridDayKey = (d: Date) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, "0")
      const day = String(d.getDate()).padStart(2, "0")
      return `${y}-${m}-${day}`
    }

    return {
      timezone,
      isLoading,
      formatTime,
      formatDateShort,
      formatDateFull,
      formatDayKey,
      formatGridDayKey,
    }
  }, [timezone, isLoading])
}
