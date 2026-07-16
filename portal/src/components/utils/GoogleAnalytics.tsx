"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"
import { useTenant } from "@/providers/tenantProvider"

type Gtag = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
}

const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/i

function ensureGtag(measurementId: string) {
  if (typeof window === "undefined") return

  window.dataLayer = window.dataLayer || []
  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args)
    }
    window.gtag("js", new Date())
  }

  const scriptSrc = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
  if (!document.querySelector(`script[src="${scriptSrc}"]`)) {
    const script = document.createElement("script")
    script.async = true
    script.src = scriptSrc
    const firstScript = document.getElementsByTagName("script")[0]
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript)
    } else {
      document.head.appendChild(script)
    }
  }
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

export default function GoogleAnalytics() {
  const pathname = usePathname()
  const { tenant } = useTenant()
  const initializedMeasurementId = useRef<string | null>(null)
  const previousPathname = useRef<string | null>(null)

  const rawMeasurementId = tenant?.ga_tracking_enabled
    ? tenant.ga_measurement_id?.trim()
    : null
  const measurementId =
    rawMeasurementId && GA4_MEASUREMENT_ID_PATTERN.test(rawMeasurementId)
      ? rawMeasurementId
      : null
  const popupSlug = resolvePopupSlug(pathname, tenant?.active_popup_slug)
  const tenantSlug = tenant?.slug

  useEffect(() => {
    if (!measurementId || initializedMeasurementId.current === measurementId) {
      return
    }

    ensureGtag(measurementId)
    window.gtag?.("config", measurementId, { send_page_view: false })
    window.gtag?.("event", "page_view", {
      ...(tenantSlug && { tenant_slug: tenantSlug }),
      ...(popupSlug && { popup_slug: popupSlug }),
    })
    initializedMeasurementId.current = measurementId
    previousPathname.current = pathname
  }, [pathname, measurementId, popupSlug, tenantSlug])

  useEffect(() => {
    if (!measurementId || initializedMeasurementId.current !== measurementId) {
      return
    }
    if (previousPathname.current === pathname) return

    previousPathname.current = pathname
    window.gtag?.("event", "page_view", {
      ...(tenantSlug && { tenant_slug: tenantSlug }),
      ...(popupSlug && { popup_slug: popupSlug }),
    })
  }, [pathname, measurementId, popupSlug, tenantSlug])

  return null
}
