import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { EventSettingsService } from "@/client"

const DEFAULT_TZ =
  (typeof Intl !== "undefined" &&
    Intl.DateTimeFormat().resolvedOptions().timeZone) ||
  "UTC"

/**
 * Returns a popup's configured timezone along with reusable formatters.
 * Falls back to the browser timezone when settings are missing.
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

  const timezone = settings?.timezone || DEFAULT_TZ
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
