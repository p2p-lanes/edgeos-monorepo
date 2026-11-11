import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { usePopupWindow } from "./usePopupWindow"

const fmt = (key: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${key}T00:00:00`))

describe("usePopupWindow hint", () => {
  it("uses the range copy when both dates are set", () => {
    const { result } = renderHook(() =>
      usePopupWindow({
        startDate: "2026-12-01T00:00:00Z",
        endDate: "2026-12-15T00:00:00Z",
      }),
    )

    expect(result.current.popupWindowHint).toEqual({
      key: "events.form.popup_window_hint",
      values: { window: `${fmt("2026-12-01")} – ${fmt("2026-12-15")}` },
    })
  })

  it("uses the 'on or after' copy when only the start date is set", () => {
    const { result } = renderHook(() =>
      usePopupWindow({ startDate: "2026-12-01T00:00:00Z", endDate: null }),
    )

    expect(result.current.popupWindowHint).toEqual({
      key: "events.form.popup_window_hint_from",
      values: { date: fmt("2026-12-01") },
    })
  })

  it("uses the 'on or before' copy when only the end date is set", () => {
    const { result } = renderHook(() =>
      usePopupWindow({ startDate: null, endDate: "2026-12-15T00:00:00Z" }),
    )

    expect(result.current.popupWindowHint).toEqual({
      key: "events.form.popup_window_hint_until",
      values: { date: fmt("2026-12-15") },
    })
  })

  it("shows no hint and allows every day without dates", () => {
    const { result } = renderHook(() => usePopupWindow({}))

    expect(result.current.popupWindowHint).toBeNull()
    expect(result.current.isDateOutsidePopupWindow(new Date(2026, 0, 1))).toBe(
      false,
    )
  })
})
