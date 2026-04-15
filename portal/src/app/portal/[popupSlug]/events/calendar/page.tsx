"use client"

import { redirect, useParams } from "next/navigation"

/**
 * Legacy route — calendar view is now a local toggle on /events. Keep the
 * path working for bookmarks by redirecting to the parent.
 */
export default function CalendarRedirectPage() {
  const params = useParams<{ popupSlug: string }>()
  redirect(`/portal/${params.popupSlug}/events`)
}
