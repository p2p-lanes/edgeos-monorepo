import type { Metadata } from "next"

import { TvCalendarClient } from "./TvCalendarClient"

interface TvCalendarPageProps {
  params: Promise<{
    popupSlug: string
  }>
}

export function generateMetadata(): Metadata {
  // Mirrors the public calendar route: the popup name isn't resolvable
  // server-side without an auth'd call, so emit a generic title and let
  // ``TvCalendarClient`` patch ``document.title`` once meta arrives.
  return {
    title: "Calendar - TV",
  }
}

/**
 * Big-screen ("TV") variant of the public ``/calendar`` route. Renders the
 * same anonymous public-calendar feed as a read-only, auto-scrolling,
 * multi-column board sized for smart-TV browsers such as ``Hi Browser``.
 * Slug + tenant resolution happens inside the client component, identical
 * to the standard public calendar.
 */
export default async function TvCalendarPage({ params }: TvCalendarPageProps) {
  const { popupSlug } = await params
  return <TvCalendarClient popupSlug={popupSlug} />
}
