"use client"

import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
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
      check_in_code: "",
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

  // Cast AttendeeWithOriginPublic[] to AttendeePassState[].
  // PassesProvider replaces products via buildBaseAttendeePasses anyway,
  // so the product field difference is irrelevant here.
  return sortAttendees(humanAttendees as unknown as AttendeePassState[])
}

export default useResolvedAttendees
