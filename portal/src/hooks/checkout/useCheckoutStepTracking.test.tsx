import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type TrackableCheckoutStep,
  useCheckoutStepTracking,
} from "./useCheckoutStepTracking"

const popup = {
  id: "popup_1",
  slug: "amanita-festival-2026",
  name: "Amanita Festival 2026",
}

const sections: TrackableCheckoutStep[] = [
  {
    id: "passes",
    stepType: "passes",
    label: "Entradas",
    config: { step_type: "tickets" },
  },
  {
    id: "buyer",
    stepType: "buyer",
    label: "Tu información",
    config: { step_type: "buyer" },
  },
]

describe("useCheckoutStepTracking", () => {
  afterEach(() => {
    delete (window as Window & { gtag?: unknown }).gtag
    vi.restoreAllMocks()
  })

  it("tracks the initial step with its runtime position and metadata", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    renderHook(() =>
      useCheckoutStepTracking({
        activeStepId: "passes",
        sections,
        popup,
      }),
    )

    expect(gtag).toHaveBeenCalledOnce()
    expect(gtag).toHaveBeenCalledWith("event", "checkout_step", {
      popup_id: "popup_1",
      popup_slug: "amanita-festival-2026",
      popup_name: "Amanita Festival 2026",
      step_number: 1,
      step_id: "passes",
      step_type: "tickets",
      step_name: "Entradas",
    })
  })

  it("ignores rerenders but tracks genuine step transitions and revisits", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    const { rerender } = renderHook(
      ({ activeStepId }) =>
        useCheckoutStepTracking({ activeStepId, sections, popup }),
      { initialProps: { activeStepId: "passes" } },
    )

    rerender({ activeStepId: "passes" })
    rerender({ activeStepId: "buyer" })
    rerender({ activeStepId: "buyer" })
    rerender({ activeStepId: "passes" })

    expect(gtag).toHaveBeenCalledTimes(3)
    expect(gtag.mock.calls.map((call) => call[2].step_id)).toEqual([
      "passes",
      "buyer",
      "passes",
    ])
  })

  it("does not track disabled previews or unknown active sections", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    const { rerender } = renderHook(
      ({ activeStepId, enabled }) =>
        useCheckoutStepTracking({
          activeStepId,
          sections,
          popup,
          enabled,
        }),
      { initialProps: { activeStepId: "passes", enabled: false } },
    )

    rerender({ activeStepId: "missing", enabled: true })

    expect(gtag).not.toHaveBeenCalled()
  })
})
