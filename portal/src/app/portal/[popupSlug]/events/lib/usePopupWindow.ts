"use client"

import { useMemo } from "react"

interface UsePopupWindowOptions {
  startDate?: string | null
  endDate?: string | null
}

export interface UsePopupWindowResult {
  popupStartKey: string | null
  popupEndKey: string | null
  isDateOutsidePopupWindow: (d: Date) => boolean
  popupWindowLabel: string | null
}

/**
 * Provides a date matcher constrained to the popup's [start_date, end_date]
 * window plus a human-readable label for hint copy. Mirrors the date-string
 * comparison used elsewhere in the portal so we avoid tz-boundary off-by-ones
 * at the UI layer; the backend re-checks the full timestamp on submit.
 */
export function usePopupWindow(
  options: UsePopupWindowOptions,
): UsePopupWindowResult {
  const popupStartKey = options.startDate
    ? options.startDate.slice(0, 10)
    : null
  const popupEndKey = options.endDate ? options.endDate.slice(0, 10) : null

  const isDateOutsidePopupWindow = useMemo(() => {
    if (!popupStartKey && !popupEndKey) return () => false
    return (d: Date) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, "0")
      const day = String(d.getDate()).padStart(2, "0")
      const key = `${y}-${m}-${day}`
      if (popupStartKey && key < popupStartKey) return true
      if (popupEndKey && key > popupEndKey) return true
      return false
    }
  }, [popupStartKey, popupEndKey])

  const popupWindowLabel = useMemo(() => {
    if (!popupStartKey && !popupEndKey) return null
    const fmt = (key: string) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${key}T00:00:00`))
    if (popupStartKey && popupEndKey)
      return `${fmt(popupStartKey)} – ${fmt(popupEndKey)}`
    if (popupStartKey) return `from ${fmt(popupStartKey)}`
    return `until ${fmt(popupEndKey as string)}`
  }, [popupStartKey, popupEndKey])

  return {
    popupStartKey,
    popupEndKey,
    isDateOutsidePopupWindow,
    popupWindowLabel,
  }
}
