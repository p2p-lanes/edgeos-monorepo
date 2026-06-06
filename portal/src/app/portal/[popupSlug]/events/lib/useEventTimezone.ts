"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { type EventSettingsPublic, EventSettingsService } from "@/client"

// Calendar surfaces must always render in the popup's timezone. When event
// settings haven't been created yet, fall back to UTC (the backend default)
// instead of the browser timezone so the displayed wall-clock matches what
// the backend stores and what emails carry.
const FALLBACK_TZ = "UTC"

// Maps i18next language codes to BCP-47 tags used by Intl.DateTimeFormat
// for month/weekday names. Time and day-key formats are locale-independent
// (numeric only) so they stay anchored to en-GB / en-CA.
const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  zh: "zh-CN",
  is: "is-IS",
}

function resolveLocale(lang: string | undefined): string {
  if (!lang) return "en-US"
  return LOCALE_MAP[lang] ?? LOCALE_MAP[lang.split("-")[0] ?? ""] ?? "en-US"
}

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
 *
 * ``timezoneOverride`` skips the authenticated event-settings query and
 * uses the provided value verbatim — used by the public calendar where
 * the timezone is sourced from the public endpoint's response meta.
 */
export function useEventTimezone(
  popupId: string | undefined,
  timezoneOverride?: string,
) {
  const { i18n } = useTranslation()
  const { data: settings, isLoading: settingsLoading } = usePortalEventSettings(
    timezoneOverride ? undefined : popupId,
  )

  const timezone = timezoneOverride || settings?.timezone || FALLBACK_TZ
  const isLoading = timezoneOverride ? false : settingsLoading
  const locale = resolveLocale(i18n.language)

  return useMemo(() => {
    const formatTime = (dateStr: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(dateStr))

    const formatDateShort = (dateStr: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date(dateStr))

    const formatDateFull = (dateStr: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(dateStr))

    // YYYY-MM-DD in the popup's timezone (for grouping/keying by day).
    // Locale-independent: this is a sort key, not displayed text.
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

    // Localized "MMMM yyyy" for the calendar header (e.g. "junio de 2026").
    const formatMonthHeader = (d: Date) =>
      new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
      }).format(d)

    // Localized weekday short labels starting Monday, in the user's locale
    // (e.g. ["lun", "mar", "mié", ...] for Spanish).
    const weekdayShortLabels = (() => {
      // Pick a known Monday (2026-06-01) and walk 7 days in nominal local
      // time so the labels are independent of timezone.
      const monday = new Date(2026, 5, 1)
      const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" })
      return Array.from({ length: 7 }, (_, i) =>
        fmt.format(new Date(monday.getTime() + i * 24 * 60 * 60 * 1000)),
      )
    })()

    return {
      timezone,
      locale,
      isLoading,
      formatTime,
      formatDateShort,
      formatDateFull,
      formatDayKey,
      formatGridDayKey,
      formatMonthHeader,
      weekdayShortLabels,
    }
  }, [timezone, isLoading, locale])
}
