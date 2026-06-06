import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { EventSettingsService } from "@/client"

// Calendar surfaces must always render in the popup's timezone. When event
// settings haven't been created yet, fall back to UTC (the backend default)
// instead of the browser timezone so the displayed wall-clock matches what
// the backend stores.
const FALLBACK_TZ = "UTC"

/**
 * Returns a popup's configured timezone along with reusable formatters.
 * Falls back to UTC when settings are missing or still loading (browser TZ
 * is never used — every consumer expects popup-tz wall-clock).
 */
export function useEventTimezone(popupId: string | undefined) {
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["event-settings", popupId],
    queryFn: async () => {
      if (!popupId) return null
      try {
        return await EventSettingsService.getEventSettings({ popupId })
      } catch {
        return null
      }
    },
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  const timezone = settings?.timezone || FALLBACK_TZ
  const isLoading = settingsLoading

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

    return {
      timezone,
      isLoading,
      formatTime,
      formatDateShort,
      formatDateFull,
      formatDayKey,
    }
  }, [timezone, isLoading])
}
