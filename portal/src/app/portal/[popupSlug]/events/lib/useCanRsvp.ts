"use client"

import { useMyTicketsQuery } from "@/hooks/useMyTicketsQuery"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

/**
 * Reason an attendee is blocked from RSVPing, or null when they can.
 * - `rejected`    — their application for this popup is in "rejected" status.
 * - `no_tickets`  — they hold no purchased ticket for this popup.
 */
export type RsvpBlockReason = "rejected" | "no_tickets" | null

/**
 * Resolves whether the current human may RSVP to events in the active popup.
 *
 * Rule (mirrors the backend gate in event_participant/register):
 *   canRsvp = has a purchased ticket for this popup AND application not rejected
 *
 * "Has a ticket" uses `listMyTickets` (the same source the portal's tickets/
 * passes views read), so companion/spouse tickets count too — matching the
 * "any ticket of the popup" definition.
 *
 * While the tickets query is loading, returns `canRsvp: true` (optimistic) to
 * avoid a flash of a disabled button; the backend is the real guard. Must be
 * called within ApplicationProvider + CityProvider (i.e. inside the portal).
 */
export function useCanRsvp(): {
  canRsvp: boolean
  reason: RsvpBlockReason
  isLoading: boolean
} {
  const { getCity } = useCityProvider()
  const { getRelevantApplication } = useApplication()
  const { data: tickets, isLoading } = useMyTicketsQuery()

  const city = getCity()
  const isRejected = getRelevantApplication()?.status === "rejected"

  const hasTickets = (tickets ?? []).some(
    (t) => t.popup_id === city?.id && (t.products?.length ?? 0) > 0,
  )

  // Rejected always blocks. Otherwise gate on tickets — but stay optimistic
  // while the tickets query is still in flight so the button doesn't flicker.
  if (isRejected) {
    return { canRsvp: false, reason: "rejected", isLoading }
  }
  if (isLoading) {
    return { canRsvp: true, reason: null, isLoading }
  }
  if (!hasTickets) {
    return { canRsvp: false, reason: "no_tickets", isLoading }
  }
  return { canRsvp: true, reason: null, isLoading }
}

export default useCanRsvp
