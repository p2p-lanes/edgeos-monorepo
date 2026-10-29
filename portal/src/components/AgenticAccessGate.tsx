"use client"

import { Key } from "lucide-react"
import type * as React from "react"
import { useTranslation } from "react-i18next"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { hasAcceptedPopupParticipation } from "@/lib/popup-participation"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

// Mirrors the sidebar's exposure rule for Agentic Access in useResources.ts:
// accepted application/companion participation or ticket-based popup access,
// with at least one module an API key can reach (events or the attendee
// directory) enabled.
export function useAgenticAccess(): {
  allowed: boolean
  eventsEnabled: boolean
  directoryEnabled: boolean
} {
  const { getCity } = useCityProvider()
  const { getApplicationsForPopup, participation } = useApplication()
  const city = getCity()
  const popupAccess = useHumanPopupAccess(city?.id ? String(city.id) : null)

  const eventsEnabled = city?.events_enabled ?? true
  // Same rule as the sidebar's Directory entry: the directory only exists
  // where people apply.
  const directoryEnabled =
    city?.takes_applications !== false &&
    (city?.show_attendee_directory ?? false)
  const applicationAccepted = hasAcceptedPopupParticipation(
    getApplicationsForPopup(),
    participation,
  )

  return {
    allowed:
      (eventsEnabled || directoryEnabled) &&
      (applicationAccepted || popupAccess.state === "allowed"),
    eventsEnabled,
    directoryEnabled,
  }
}

export function AgenticAccessUnavailable() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Key className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <h1 className="text-xl font-semibold">
          {t("agentic_access.unavailable_heading", {
            defaultValue: "Not available for this popup",
          })}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {t("agentic_access.unavailable_message", {
            defaultValue:
              "API keys work with the event calendar and the attendee directory, and neither is enabled for this popup.",
          })}
        </p>
      </div>
    </div>
  )
}

// Wrapper variant for callers that prefer a declarative gate over an
// early-return — handy from server components, where the page can stay
// server-rendered (and keep its `metadata` export) while delegating the
// access check to this client island.
export function AgenticAccessGate({ children }: { children: React.ReactNode }) {
  const { allowed } = useAgenticAccess()
  if (!allowed) return <AgenticAccessUnavailable />
  return <>{children}</>
}
