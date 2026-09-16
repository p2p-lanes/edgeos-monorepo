"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"

import { useGatheringDoors } from "@/hooks/useGatheringDoors"

/**
 * Sends a visitor back to pick a way in when the page needs one.
 *
 * Passes and the checkout are about one application: its people, its
 * balance, its steps. Opened without a door by someone holding two, they
 * used to answer for both at once — two applications' attendees listed
 * side by side with nothing marking which was which, or a checkout with
 * nothing in it (sdd/sales-flows-rediseno).
 *
 * Neither is a state worth rendering, so the page does not. The gathering
 * home is where the choice is made, and it is one click away rather than a
 * dead end.
 *
 * A single door is unambiguous and never redirects, which is almost every
 * gathering.
 *
 * @returns Whether the page should hold off rendering — either the doors
 *   are still loading or a redirect is on its way.
 */
export function useRequireDoor(
  popupId: string | null | undefined,
  popupSlug: string,
): boolean {
  const router = useRouter()
  const flowId = useSearchParams().get("flow")
  const { doors, isLoading } = useGatheringDoors(popupId)

  const mustChoose = !isLoading && !flowId && doors.length > 1

  useEffect(() => {
    if (!mustChoose) return
    router.replace(`/portal/${popupSlug}`)
  }, [mustChoose, popupSlug, router])

  return mustChoose || isLoading
}
