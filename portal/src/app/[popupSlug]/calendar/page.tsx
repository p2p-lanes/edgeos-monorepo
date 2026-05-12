import type { Metadata } from "next"

import { PublicCalendarClient } from "./PublicCalendarClient"

interface PublicCalendarPageProps {
  params: Promise<{
    popupSlug: string
  }>
}

export function generateMetadata(): Metadata {
  // We can't resolve the popup name server-side here without an auth'd
  // call, so emit a generic title; ``PublicCalendarClient`` overrides
  // ``document.title`` to ``"{popup_name} - Calendar"`` once the public
  // calendar query returns ``meta.popup_name``.
  return {
    title: "Calendar",
  }
}

/**
 * Anonymous-friendly calendar route. Slug + tenant resolution happens
 * inside the client component so we can avoid a server-side fetch (the
 * public calendar endpoint already validates the slug and 404s if it
 * doesn't belong to the resolved tenant).
 */
export default async function PublicCalendarPage({
  params,
}: PublicCalendarPageProps) {
  const { popupSlug } = await params
  return <PublicCalendarClient popupSlug={popupSlug} />
}
