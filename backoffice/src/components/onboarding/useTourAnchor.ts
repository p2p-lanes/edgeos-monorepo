import { useEffect, useState } from "react"

import type { TourAnchorId } from "./types"

/** Viewport-relative box of the highlighted element. */
export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

/** How long to keep looking before declaring an anchor missing. */
const RESOLVE_TIMEOUT_MS = 2_000

export function tourAnchorSelector(anchorId: TourAnchorId): string {
  return `[data-tour="${CSS.escape(anchorId)}"]`
}

function readRect(el: Element): AnchorRect | null {
  const { top, left, width, height } = el.getBoundingClientRect()
  // A `forceMount`ed-but-hidden panel (PopupForm's inactive tabs) and a
  // collapsed sidebar both measure as an empty box. Treating that as "not
  // resolved yet" lets the retry loop wait for the tab switch to paint, and
  // lets a genuinely absent anchor fall through to onMissing.
  if (width === 0 && height === 0) return null
  return { top, left, width, height }
}

function sameRect(a: AnchorRect | null, b: AnchorRect | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  )
}

interface UseTourAnchorOptions {
  /** Pause resolution (tour inactive, or a centered step with no anchor). */
  enabled: boolean
  /** Called once when the anchor never showed up. The step should be skipped. */
  onMissing: () => void
  /** Overridable so tests do not have to wait out the real deadline. */
  timeoutMs?: number
}

/**
 * Resolves a `data-tour` anchor to a live viewport rect.
 *
 * Retries on every animation frame until the deadline, because the anchor may
 * not exist yet: the tour navigates between routes, and the target element
 * only mounts once the destination route has rendered. After it resolves, the
 * same loop keeps the rect current through sidebar animations, tab switches
 * and layout shifts — cheaper to reason about than a pile of scroll, resize
 * and transition listeners, and it only runs while the tour is on screen.
 */
export function useTourAnchor(
  anchorId: TourAnchorId | undefined,
  { enabled, onMissing, timeoutMs = RESOLVE_TIMEOUT_MS }: UseTourAnchorOptions,
): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null)

  useEffect(() => {
    if (!enabled || !anchorId) {
      setRect(null)
      return
    }

    let frame = 0
    let didScroll = false
    let didReportMissing = false
    let current: AnchorRect | null = null
    const deadline = Date.now() + timeoutMs

    setRect(null)

    const tick = () => {
      const el = document.querySelector(tourAnchorSelector(anchorId))
      const next = el ? readRect(el) : null

      if (next && el) {
        if (!didScroll) {
          didScroll = true
          // Not available in jsdom.
          el.scrollIntoView?.({ block: "center", behavior: "smooth" })
        }
        if (!sameRect(current, next)) {
          current = next
          setRect(next)
        }
      } else if (!didReportMissing && Date.now() > deadline) {
        didReportMissing = true
        if (import.meta.env.DEV) {
          console.warn(
            `[tour] anchor "${anchorId}" never resolved — skipping this step. ` +
              `Did a data-tour attribute get dropped in a refactor?`,
          )
        }
        onMissing()
        return
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [anchorId, enabled, onMissing, timeoutMs])

  return rect
}
