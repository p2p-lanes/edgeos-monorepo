"use client"

import { toast } from "sonner"

import { portalFetch } from "@/lib/session-network"

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 60) || "event"
  )
}

/**
 * Download the iCalendar file for a portal event.
 * Uses the same-origin session adapter so the file streams without browser tokens.
 */
export async function downloadEventIcs({
  eventId,
  title,
}: {
  eventId: string
  title?: string | null
}): Promise<void> {
  const dismissId = toast.loading("Preparing calendar file...")
  try {
    const response = await portalFetch(
      `/api/v1/events/portal/events/${eventId}/ics`,
      { headers: { Accept: "text/calendar" } },
    )

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const blob = await response.blob()
    const blobUrl = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = blobUrl
    link.download = `event-${slugify(title ?? eventId)}.ics`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(blobUrl)

    toast.success("Calendar file downloaded", { id: dismissId })
  } catch (err: unknown) {
    console.error("Error downloading ICS:", err)
    toast.error("Failed to download calendar file", { id: dismissId })
  }
}
