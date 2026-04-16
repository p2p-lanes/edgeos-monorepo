"use client"

import { useMemo } from "react"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import { sortAttendees } from "@/helpers/filters"
import useAuth from "@/hooks/useAuth"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeePassState } from "@/types/Attendee"

/**
 * Resolves the attendees list the PassesProvider should drive off.
 *
 * - For application-flow popups (`sale_type === "application"`, the default):
 *   reads attendees from the current application via `useApplication`.
 * - For direct-sale popups (`sale_type === "direct"`): returns a synthetic
 *   "main" attendee derived from the authenticated human. The direct-sale
 *   flow does not create a real Attendee row until the payment POST hits
 *   the backend, so we fabricate a virtual one here to keep the existing
 *   PassesProvider machinery working unchanged.
 *
 * When no city is loaded, no user is logged in, or required data is missing
 * for the direct-sale branch, the hook returns an empty list.
 */
export function useResolvedAttendees(): AttendeePassState[] {
  const { getCity } = useCityProvider()
  const { getAttendees } = useApplication()
  const { user } = useAuth()

  const city = getCity()
  const policy = resolvePopupCheckoutPolicy(city)

  return useMemo(() => {
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

    return sortAttendees(getAttendees())
  }, [policy.saleType, city, user, getAttendees])
}

export default useResolvedAttendees
