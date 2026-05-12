"use client"

import { useEffect, useId } from "react"

/**
 * Per-popup tracking snippet injection.
 *
 * Tenants drop HTML/JS into `Popup.tracking_snippets` (a JSONB blob with
 * `cart`, `buyer`, `thank_you` keys) for analytics pixels — Facebook,
 * Instagram, Google Ads, anything that needs to fire on the checkout
 * funnel. Each anchor mounts this component with the matching slot; the
 * component renders the markup inside an isolated wrapper and tags it with
 * a data attribute so it's easy to identify in the DOM.
 *
 * Security note: snippets are tenant-authored, NOT buyer-authored, so they
 * are trusted at write time. Backoffice-side, the editor should warn that
 * the content runs as page JS. We still scope each snippet to its own
 * <div> so a runaway snippet can't leak styles or detach unrelated nodes.
 */
interface TrackingSnippetProps {
  /** Which slot from `Popup.tracking_snippets` to render. */
  anchor: "cart" | "buyer" | "thank_you"
  /** Raw tracking_snippets dict from the runtime payload, or null. */
  snippets?: Record<string, unknown> | null
}

export default function TrackingSnippet({
  anchor,
  snippets,
}: TrackingSnippetProps) {
  const containerId = useId()
  const raw = snippets?.[anchor]
  const html = typeof raw === "string" ? raw : ""

  // Re-mount the snippet's <script> tags whenever the HTML changes. Setting
  // innerHTML on its own doesn't execute scripts — we have to clone them
  // into new <script> nodes after injection.
  useEffect(() => {
    if (!html) return
    const el = document.getElementById(containerId)
    if (!el) return
    el.innerHTML = html
    const scripts = el.querySelectorAll("script")
    for (const old of Array.from(scripts)) {
      const next = document.createElement("script")
      for (const attr of Array.from(old.attributes)) {
        next.setAttribute(attr.name, attr.value)
      }
      if (old.textContent) next.textContent = old.textContent
      old.parentNode?.replaceChild(next, old)
    }
    return () => {
      el.innerHTML = ""
    }
  }, [containerId, html])

  if (!html) return null

  return (
    <div
      id={containerId}
      data-tracking-anchor={anchor}
      aria-hidden="true"
      style={{ display: "none" }}
    />
  )
}
