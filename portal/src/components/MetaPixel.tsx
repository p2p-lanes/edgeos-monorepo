"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"
import { useTenant } from "@/providers/tenantProvider"

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  loaded?: boolean
  push?: Fbq
  queue?: unknown[]
  version?: string
}

declare global {
  interface Window {
    _fbq?: Fbq
    fbq?: Fbq
  }
}

function ensureFbq() {
  if (typeof window === "undefined" || window.fbq) return

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod(...args)
      return
    }
    fbq.queue?.push(args)
  }) as Fbq

  window.fbq = fbq
  if (!window._fbq) window._fbq = fbq

  fbq.push = fbq
  fbq.loaded = true
  fbq.version = "2.0"
  fbq.queue = []

  const script = document.createElement("script")
  script.async = true
  script.src = "https://connect.facebook.net/en_US/fbevents.js"
  const firstScript = document.getElementsByTagName("script")[0]
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript)
    return
  }
  document.head.appendChild(script)
}

function resolvePopupSlug(pathname: string, activePopupSlug?: string | null) {
  const segments = pathname.split("/").filter(Boolean)
  const [first, second] = segments

  if (first === "checkout" || first === "portal") return second ?? null
  if (
    !first ||
    first === "auth" ||
    first === "coming-soon" ||
    first === "groups"
  ) {
    return activePopupSlug ?? null
  }
  return first
}

export function MetaPixel() {
  const pathname = usePathname()
  const { tenant } = useTenant()
  const initializedPixelId = useRef<string | null>(null)
  const previousPathname = useRef<string | null>(null)

  const pixelId = tenant?.meta_tracking_enabled
    ? tenant.meta_pixel_id?.trim()
    : null
  const popupSlug = resolvePopupSlug(pathname, tenant?.active_popup_slug)
  const tenantSlug = tenant?.slug

  useEffect(() => {
    if (!pixelId || initializedPixelId.current === pixelId) return

    ensureFbq()
    window.fbq?.("init", pixelId)
    window.fbq?.("track", "PageView", {
      ...(tenantSlug && { tenant_slug: tenantSlug }),
      ...(popupSlug && { popup_slug: popupSlug }),
    })
    initializedPixelId.current = pixelId
    previousPathname.current = pathname
  }, [pathname, pixelId, popupSlug, tenantSlug])

  useEffect(() => {
    if (!pixelId || initializedPixelId.current !== pixelId) return
    if (previousPathname.current === pathname) return

    previousPathname.current = pathname
    window.fbq?.("track", "PageView", {
      ...(tenantSlug && { tenant_slug: tenantSlug }),
      ...(popupSlug && { popup_slug: popupSlug }),
    })
  }, [pathname, pixelId, popupSlug, tenantSlug])

  return null
}
