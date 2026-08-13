/**
 * Tests for useTourAnchor — resolving a `data-tour` element to a live rect.
 *
 * Covers:
 * - a present element resolves to its box
 * - an anchor that never appears reports missing, so the step is skipped
 *   instead of hanging the tour on a dimmed screen
 * - a mounted-but-hidden element (PopupForm's inactive tabs measure as an
 *   empty box) counts as unresolved until it becomes visible
 * - a disabled hook neither resolves nor reports
 */
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useTourAnchor } from "./useTourAnchor"

const VISIBLE = { top: 10, left: 20, width: 100, height: 40 }

function mountAnchor(id: string, box = VISIBLE) {
  const el = document.createElement("div")
  el.setAttribute("data-tour", id)
  el.getBoundingClientRect = () =>
    ({
      ...box,
      bottom: box.top + box.height,
      right: box.left + box.width,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("useTourAnchor", () => {
  it("resolves a present anchor to its box", async () => {
    mountAnchor("nav-attendees")
    const onMissing = vi.fn()

    const { result } = renderHook(() =>
      useTourAnchor("nav-attendees", { enabled: true, onMissing }),
    )

    await waitFor(() => expect(result.current).toEqual(VISIBLE))
    expect(onMissing).not.toHaveBeenCalled()
  })

  it("reports an anchor that never shows up", async () => {
    const onMissing = vi.fn()

    renderHook(() =>
      useTourAnchor("nav-nowhere", {
        enabled: true,
        onMissing,
        timeoutMs: 30,
      }),
    )

    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1))
  })

  it("treats a mounted-but-hidden anchor as not yet resolved", async () => {
    // What an inactive `forceMount`ed TabsContent measures as.
    mountAnchor("popup-tab-commerce", {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    })
    const onMissing = vi.fn()

    const { result } = renderHook(() =>
      useTourAnchor("popup-tab-commerce", {
        enabled: true,
        onMissing,
        timeoutMs: 30,
      }),
    )

    await waitFor(() => expect(onMissing).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it("picks the anchor up once it becomes visible", async () => {
    const el = mountAnchor("popup-tab-commerce", {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    })
    const onMissing = vi.fn()

    const { result } = renderHook(() =>
      useTourAnchor("popup-tab-commerce", { enabled: true, onMissing }),
    )

    expect(result.current).toBeNull()

    act(() => {
      el.getBoundingClientRect = () =>
        ({
          ...VISIBLE,
          bottom: 50,
          right: 120,
          x: 20,
          y: 10,
          toJSON: () => ({}),
        }) as DOMRect
    })

    await waitFor(() => expect(result.current).toEqual(VISIBLE))
    expect(onMissing).not.toHaveBeenCalled()
  })

  it("does nothing while disabled", async () => {
    mountAnchor("nav-attendees")
    const onMissing = vi.fn()

    const { result } = renderHook(() =>
      useTourAnchor("nav-attendees", {
        enabled: false,
        onMissing,
        timeoutMs: 30,
      }),
    )

    await new Promise((r) => setTimeout(r, 60))
    expect(result.current).toBeNull()
    expect(onMissing).not.toHaveBeenCalled()
  })
})
