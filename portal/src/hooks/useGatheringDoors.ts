"use client"

import { useQuery } from "@tanstack/react-query"

import { type ApplicationPublic, SalesFlowsService } from "@/client"
import { useApplication } from "@/providers/applicationProvider"

/**
 * The ways one person can be part of one gathering.
 *
 * A sales flow, in the buyer's words. Someone accepted as a volunteer who
 * also applied for general entry holds two of these: two forms, two
 * statuses, two sets of attendees, two balances
 * (sdd/sales-flows-rediseno). The portal used to assume one and, when
 * there were two, took the older of them without saying so.
 *
 * The word "flow" never reaches the screen — a buyer has no such concept.
 * They see the name the organiser gave it.
 */
export interface GatheringDoor {
  flowId: string
  /** The organiser's name for it. Not shown when there is only one door. */
  name: string
  slug: string
  /** Absent when the person has not applied through this door yet. */
  application: ApplicationPublic | null
  status: "none" | "draft" | "in review" | "accepted" | "rejected"
}

function statusOf(
  application: ApplicationPublic | null,
): GatheringDoor["status"] {
  if (!application) return "none"
  const raw = application.status
  if (
    raw === "draft" ||
    raw === "in review" ||
    raw === "accepted" ||
    raw === "rejected"
  ) {
    return raw
  }
  return "none"
}

/**
 * @param popupId The gathering being looked at.
 * @returns Every door this person can see, plus their standing in each.
 *
 * Doors they have not entered are included when the organiser listed them
 * in the portal — `direct_url_only` ones stay hidden, which is the
 * visibility choice that already exists rather than a new rule. A door they
 * were rejected from stays on the list: vanishing without explanation is
 * the kind of silence this redesign has been removing.
 */
export function useGatheringDoors(popupId: string | null | undefined): {
  doors: GatheringDoor[]
  isLoading: boolean
} {
  const { getApplicationsForPopup } = useApplication()

  const { data, isLoading } = useQuery({
    queryKey: ["portal-sales-flows", popupId],
    queryFn: () =>
      SalesFlowsService.listPortalSalesFlows({ popupId: popupId! }),
    enabled: !!popupId,
  })

  const mine = getApplicationsForPopup()
  const listed = data?.results ?? []
  const byFlow = new Map(
    mine.filter((a) => a.sales_flow_id).map((a) => [a.sales_flow_id, a]),
  )

  const doors: GatheringDoor[] = listed.map((flow) => {
    const application = byFlow.get(flow.id) ?? null
    byFlow.delete(flow.id)
    return {
      flowId: flow.id,
      name: flow.name,
      slug: flow.slug,
      application,
      status: statusOf(application),
    }
  })

  // An application through a door that is no longer listed still belongs to
  // this person. Dropping it would hide passes they already paid for.
  for (const application of byFlow.values()) {
    doors.push({
      flowId: application.sales_flow_id,
      name: "",
      slug: "",
      application,
      status: statusOf(application),
    })
  }

  return { doors, isLoading }
}
