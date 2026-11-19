"use client"

import { useMemo } from "react"

interface UsePopupWindowOptions {
  startDate?: string | null
  endDate?: string | null
}

export interface PopupWindowHint {
  key:
    | "events.form.popup_window_hint"
    | "events.form.popup_window_hint_from"
    | "events.form.popup_window_hint_until"
  values: { window: string } | { date: string }
}

export interface UsePopupWindowResult {
  popupStartKey: string | null
  popupEndKey: string | null
  isDateOutsidePopupWindow: (d: Date) => boolean
  popupWindowHint: PopupWindowHint | null
}

/**
 * Provides a date matcher constrained to the popup's [start_date, end_date]
 * window plus the translation key and values for the hint copy. Mirrors the date-string
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

  const popupWindowHint = useMemo((): PopupWindowHint | null => {
    if (!popupStartKey && !popupEndKey) return null
    const fmt = (key: string) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${key}T00:00:00`))
    if (popupStartKey && popupEndKey)
      return {
        key: "events.form.popup_window_hint",
        values: { window: `${fmt(popupStartKey)} – ${fmt(popupEndKey)}` },
      }
    if (popupStartKey)
      return {
        key: "events.form.popup_window_hint_from",
        values: { date: fmt(popupStartKey) },
      }
    return {
      key: "events.form.popup_window_hint_until",
      values: { date: fmt(popupEndKey as string) },
    }
  }, [popupStartKey, popupEndKey])

  return {
    popupStartKey,
    popupEndKey,
    isDateOutsidePopupWindow,
    popupWindowHint,
  }
}
