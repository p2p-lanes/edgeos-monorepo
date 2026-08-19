"use client"

import { dedupTicketEntries } from "@/app/portal/[popupSlug]/passes/utils/dedupTickets"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import type { AttendeeWithOriginPublic } from "@/client"
import { sortAttendees } from "@/helpers/filters"
import useAuth from "@/hooks/useAuth"
import useHumanAttendeesQuery from "@/hooks/useHumanAttendeesQuery"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeePassState } from "@/types/Attendee"

/**
 * Resolves the attendees list the PassesProvider should drive off.
 *
 * - For direct-sale popups (`sale_type === "direct"`): uses the persisted
 *   attendee when one exists. After a successful empty response, it returns a
 *   synthetic "main" attendee so pre-purchase checkout still has an attendee.
 *
 * - For application-flow popups (all other `sale_type` values): calls
 *   `GET /attendees/my/popup/{popup_id}` via `useHumanAttendeesQuery` and
 *   returns the unified flat list (application-linked + direct-sale attendees).
 *   This replaces the previous read of `application.attendees[]` through the
 *   ApplicationProvider aggregate.
 *
 * Queries without attendee data return an empty list. Retained data remains
 * usable when a background refetch fails.
 *
 * The hook signature is unchanged for all consumers.
 */
export function useResolvedAttendees(): AttendeePassState[] {
  const { getCity } = useCityProvider()
  const { user } = useAuth()

  const city = getCity()
  const policy = resolvePopupCheckoutPolicy(city)

  // Always call the hook — conditional hooks are forbidden by Rules of Hooks.
  // The hook disables the query when popupId is null/falsy or no human is logged in.
  const popupId = city ? String(city.id) : null
  const { data: humanAttendees } = useHumanAttendeesQuery(popupId)

  if (humanAttendees === undefined) return []

  if (humanAttendees.length > 0) {
    const withTicketEntries = humanAttendees.map(
      (attendee: AttendeeWithOriginPublic): AttendeePassState => ({
        ...(attendee as unknown as AttendeePassState),
        products: [],
        ticket_entries: dedupTicketEntries(attendee.products ?? []),
      }),
    )
    return sortAttendees(withTicketEntries)
  }

  if (policy.saleType === "direct" && city && user) {
    const firstName = user.first_name?.trim() ?? ""
    const lastName = user.last_name?.trim() ?? ""
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
    const displayName = fullName || user.email

    const virtualAttendee: AttendeePassState = {
      id: user.id,
      tenant_id: user.tenant_id,
      popup_id: city.id,
      human_id: user.id,
      application_id: null,
      name: displayName,
      category: "main",
      email: user.email,
      gender: user.gender ?? null,
      poap_url: null,
      created_at: null,
      updated_at: null,
      products: [],
    }

    return [virtualAttendee]
  }

  return []
}

export default useResolvedAttendees
