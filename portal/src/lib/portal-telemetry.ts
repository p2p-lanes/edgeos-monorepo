"use client"

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void }

export type PortalTelemetryEvent =
  | "portal_navigation"
  | "checkout_opened"
  | "checkout_completed"
  | "checkout_failed"
  | "access_code_opened"

export function trackPortalTelemetry(event: PortalTelemetryEvent) {
  if (typeof window === "undefined") return

  const gtag = (window as GtagWindow).gtag
  if (typeof gtag !== "function") return

  gtag("event", event, { surface: "portal" })
}
