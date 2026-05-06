"use client"

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
 * - For direct-sale popups (`sale_type === "direct"`): returns a synthetic
 *   "main" attendee derived from the authenticated human. The direct-sale
 *   flow does not create a real Attendee row until the payment POST hits
 *   the backend, so we fabricate a virtual one here to keep the existing
 *   PassesProvider machinery working unchanged.
 *
 * - For application-flow popups (all other `sale_type` values): calls
 *   `GET /attendees/my/popup/{popup_id}` via `useHumanAttendeesQuery` and
 *   returns the unified flat list (application-linked + direct-sale attendees).
 *   This replaces the previous read of `application.attendees[]` through the
 *   ApplicationProvider aggregate.
 *
 * When no city is loaded, no user is logged in, or required data is missing
 * for the direct-sale branch, the hook returns an empty list.
 *
 * The hook signature is unchanged for all consumers.
 */
export function useResolvedAttendees(): AttendeePassState[] {
  const { getCity } = useCityProvider()
  const { user } = useAuth()

  const city = getCity()
  const policy = resolvePopupCheckoutPolicy(city)

  // Always call the hook — conditional hooks are forbidden by Rules of Hooks.
  // The hook disables the query when popupId is null/falsy.
  const popupId = city ? String(city.id) : null
  const { data: humanAttendees, isLoading } = useHumanAttendeesQuery(
    policy.saleType === "direct" ? null : popupId,
  )

  if (policy.saleType === "direct") {
    if (!city || !user) return []

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
      check_in_code: null,
      poap_url: null,
      created_at: null,
      updated_at: null,
      products: [],
    }

    return [virtualAttendee]
  }

  // Application-flow popup: use the unified human-popup query.
  // While loading, return empty to avoid stale partial lists.
  if (isLoading || !humanAttendees) return []

  // Map AttendeeWithOriginPublic[] to AttendeePassState[].
  // PassesProvider replaces products via buildBaseAttendeePasses anyway,
  // so the product field is overwritten. We extract per-ticket entries into
  // ticket_entries so QR display in AttendeeTicket can use them.
  const withTicketEntries = humanAttendees.map(
    (attendee: AttendeeWithOriginPublic): AttendeePassState => ({
      ...(attendee as unknown as AttendeePassState),
      products: [],
      ticket_entries: (attendee.products ?? []).map((ap) => ({
        id: ap.id,
        attendee_id: ap.attendee_id,
        product_id: ap.product_id,
        check_in_code: ap.check_in_code,
        payment_id: ap.payment_id ?? null,
        // product_name and requires_check_in are not in AttendeeProductPublic;
        // they will be undefined here and TicketQRList defaults requires_check_in to true.
        // A future enrichment can pass them via a separate ticket-detail endpoint.
      })),
    }),
  )
  return sortAttendees(withTicketEntries)
}

export default useResolvedAttendees
