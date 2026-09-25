"use client"

import { useQuery } from "@tanstack/react-query"
import { EventParticipantsService } from "@/client"
import { useCityProvider } from "@/providers/cityProvider"

export type RsvpBlockReason = "rejected" | "no_tickets" | null

/** Share the server's ticket and main-application policy with every RSVP UI. */
export function useCanRsvp(): {
  canRsvp: boolean
  reason: RsvpBlockReason
  isLoading: boolean
} {
  const { getCity } = useCityProvider()
  const popupId = getCity()?.id
  const { data, isLoading } = useQuery({
    queryKey: ["portal-rsvp-eligibility", popupId],
    queryFn: () =>
      EventParticipantsService.getPortalRsvpEligibility({ popupId: popupId! }),
    enabled: !!popupId,
  })
  return {
    canRsvp: data?.allowed ?? false,
    reason: data?.reason ?? null,
    isLoading,
  }
}

export default useCanRsvp
