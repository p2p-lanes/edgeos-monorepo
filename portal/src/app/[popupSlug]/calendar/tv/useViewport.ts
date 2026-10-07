"use client"

import { useEffect, useState } from "react"

export interface Viewport {
  width: number
  height: number
  /** Number of event columns to draw — 2 once the viewport is TV-wide. */
  columns: number
  /**
   * Typography multiplier derived from the viewport width so text stays
   * legible at TV viewing distance. Clamped to a sane range so a phone
   * doesn't shrink to nothing and an 8K panel doesn't blow up.
   */
  scale: number
}

// Below this width we fall back to a single column (phones, narrow embeds).
const TWO_COLUMN_MIN_WIDTH = 1100
// Reference width the scale is normalised against (a 1080p TV).
const BASELINE_WIDTH = 1920

function measure(): Viewport {
  // SSR / pre-hydration: assume a 1080p TV so the first paint already
  // approximates the target device instead of a phone.
  if (typeof window === "undefined") {
    return { width: BASELINE_WIDTH, height: 1080, columns: 2, scale: 1 }
  }
  const width = window.innerWidth
  const height = window.innerHeight
  const columns = width >= TWO_COLUMN_MIN_WIDTH ? 2 : 1
  const scale = Math.min(1.6, Math.max(0.85, width / BASELINE_WIDTH))
  return { width, height, columns, scale }
}

/**
 * Reads the live browser view field (``innerWidth`` / ``innerHeight``) into
 * React state and keeps it current across resizes / orientation changes.
 * The TV calendar uses it to decide column count and typography scale so
 * the layout is drawn for whatever panel ``Hi Browser`` reports.
 */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(measure)

  useEffect(() => {
    let frame = 0
    const onResize = () => {
      // Coalesce bursts of resize events into one measurement per frame.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setViewport(measure()))
    }
    // Measure once on mount so the post-hydration value reflects the real
    // device rather than the SSR assumption.
    onResize()
    window.addEventListener("resize", onResize)
    window.addEventListener("orientationchange", onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("orientationchange", onResize)
    }
  }, [])

  return viewport
}
