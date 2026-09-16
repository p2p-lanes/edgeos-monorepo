"use client"

import { CalendarDays } from "lucide-react"
import type * as React from "react"
import { useTranslation } from "react-i18next"
import { hasAcceptedPopupParticipation } from "@/lib/popup-participation"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

// Mirrors the sidebar's exposure rule for Agentic Access in
// useResources.ts: shown once the human has any accepted popup participation
// (application or companion) and the events module is enabled. Direct-sale
// popups never expose this subsection, so navigating to
// /portal/agentic-access by URL must fall through to the unavailable state.
export function useEventsApiAccess(): { allowed: boolean } {
  const { getCity } = useCityProvider()
  const { getApplicationsForPopup, participation } = useApplication()
  const city = getCity()

  // Agentic access hangs off an accepted application, so it is gated on
  // whether anybody applies here rather than on how the popup sells.
  const nobodyApplies = city?.takes_applications === false
  const eventsEnabled = city?.events_enabled ?? true
  const applicationAccepted = hasAcceptedPopupParticipation(
    getApplicationsForPopup(),
    participation,
  )

  return {
    allowed: !nobodyApplies && eventsEnabled && applicationAccepted,
  }
}

export function EventsApiAccessUnavailable() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <h1 className="text-xl font-semibold">
          {t("events.api_access.unavailable_heading", {
            defaultValue: "Not available for this popup",
          })}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {t("events.api_access.unavailable_message", {
            defaultValue:
              "API keys and the events API docs are part of the events module, which isn't enabled for this popup.",
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
export function EventsApiAccessGate({
  children,
}: {
  children: React.ReactNode
}) {
  const { allowed } = useEventsApiAccess()
  if (!allowed) return <EventsApiAccessUnavailable />
  return <>{children}</>
}
