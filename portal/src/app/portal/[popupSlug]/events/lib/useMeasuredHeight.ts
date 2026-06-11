"use client"

import { type RefObject, useEffect, useRef, useState } from "react"

/**
 * Tracks an element's rendered height (including padding/border) via
 * ResizeObserver. Used to anchor stacked sticky day headers right below the
 * sticky filter toolbar, whose height changes as its filter chips wrap onto
 * a second row on narrow viewports. Returns a ref to attach to the measured
 * element and its current height in px.
 */
export function useMeasuredHeight<T extends HTMLElement>(
  initial = 0,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, height]
}
