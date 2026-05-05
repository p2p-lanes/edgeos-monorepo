"use client"

import { CalendarDays } from "lucide-react"
import type * as React from "react"
import { useTranslation } from "react-i18next"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

// Mirrors the sidebar's exposure rule for API Keys / API Docs in
// useResources.ts: shown only on the standard (application-based) flow,
// for accepted attendees, when the events module is enabled at the popup
// level. Direct-sale and companion flows never expose these subsections,
// so navigating to /portal/api-keys or /portal/docs by URL must fall
// through to the unavailable state instead of rendering the page.
export function useEventsApiAccess(): { allowed: boolean } {
  const { getCity } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  const city = getCity()
  const application = getRelevantApplication()

  const isDirectSale = city?.sale_type === "direct"
  const isCompanion = participation?.type === "companion"
  const eventsEnabled = city?.events_enabled ?? true
  const canSeeAttendees = application?.status === "accepted"

  return {
    allowed:
      !isDirectSale && !isCompanion && eventsEnabled && canSeeAttendees,
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
