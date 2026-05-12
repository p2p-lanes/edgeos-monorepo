"use client"

import { useEffect } from "react"

/**
 * Per-popup favicon swap.
 *
 * The root `generateMetadata` already sets a tenant-level favicon via
 * `tenant.icon_url`. This component layers a popup-scoped override on top:
 * when `Popup.favicon_url` is set, it injects a fresh `<link rel="icon">`
 * into `<head>` while the checkout is mounted, and restores the previous
 * icons on unmount. Works for SPA navigation as well as full reloads.
 */
export default function FaviconOverride({ url }: { url: string | null }) {
  useEffect(() => {
    if (!url) return
    const head = document.head
    const previous = Array.from(
      head.querySelectorAll<HTMLLinkElement>(
        "link[rel='icon'], link[rel='shortcut icon']",
      ),
    )
    // Hide the previous icons rather than detach them; this lets us
    // re-enable them cleanly on unmount without losing their other attrs.
    for (const link of previous) {
      link.dataset.previousRel = link.rel
      link.rel = "alternate icon"
    }

    const override = document.createElement("link")
    override.rel = "icon"
    override.href = url
    override.dataset.popupOverride = "true"
    head.appendChild(override)

    return () => {
      override.remove()
      for (const link of previous) {
        if (link.dataset.previousRel) {
          link.rel = link.dataset.previousRel
          delete link.dataset.previousRel
        }
      }
    }
  }, [url])

  return null
}
