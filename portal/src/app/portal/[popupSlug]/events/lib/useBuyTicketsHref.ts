"use client"

import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalPrimarySalesFlow } from "@/hooks/usePortalPrimarySalesFlow"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import {
  getEligiblePortalFlows,
  resolvePassPurchaseFlowSlug,
} from "@/lib/portal-sales-flows"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

/**
 * Builds the destination for a "buy a ticket" CTA.
 *
 * When the attendee has exactly one door into the popup we send them straight
 * to that shop flow, which is the canonical authenticated purchase route
 * (`/portal/{slug}/shop/{flowSlug}`, same target the Passes page pushes to).
 * When several doors are eligible, or none resolves, we fall back to the
 * Passes page: it owns the disambiguation UI and the empty-state buy button,
 * so the attendee still lands one tap away from checkout instead of on a
 * guessed flow.
 */
export function buildBuyTicketsHref(
  popupSlug: string | undefined | null,
  flowSlug: string | null,
): string | null {
  if (!popupSlug) return null
  return flowSlug
    ? `/portal/${popupSlug}/shop/${flowSlug}`
    : `/portal/${popupSlug}/passes`
}

/**
 * Resolves where a ticketless attendee should go to buy a ticket for the
 * active popup, or `null` when no popup is in context.
 *
 * Mirrors the flow resolution in `portal/[popupSlug]/passes/page.tsx` so the
 * two entry points cannot drift. Must be called inside CityProvider +
 * ApplicationProvider, and only when a purchase CTA is actually rendered, so
 * the three sales-flow queries stay off the hot path for everyone else.
 */
export function useBuyTicketsHref(): string | null {
  const { getCity } = useCityProvider()
  const { getApplicationsForPopup } = useApplication()

  const city = getCity()
  const popupId = city?.id ? String(city.id) : undefined
  const popupAccess = useHumanPopupAccess(popupId)
  const hasTicketAccess =
    popupAccess.state === "allowed" &&
    (popupAccess.source === "attendee" || popupAccess.source === "payment")

  const applicationFlows = usePortalSalesFlows(popupId).data ?? []
  const directFlows = usePortalDirectSalesFlows(popupId).data ?? []
  const upsaleFlows = usePortalUpsaleFlows(popupId).data ?? []
  const primaryFlowSlug = usePortalPrimarySalesFlow(city?.slug).data?.flow_slug

  const applications = getApplicationsForPopup()
  const approvedApplicationFlowIds = new Set<string>(
    applications.flatMap((application) =>
      application.status === "accepted" && application.sales_flow_id
        ? [application.sales_flow_id]
        : [],
    ),
  )

  const eligibleFlows = getEligiblePortalFlows({
    application: applicationFlows,
    direct: directFlows,
    upsale: upsaleFlows,
    approvedApplicationFlowIds,
    primaryFlowSlug: hasTicketAccess ? primaryFlowSlug : null,
  })
  const eligibleFlowIds = new Set(eligibleFlows.map((flow) => flow.id))

  const flowSlug = resolvePassPurchaseFlowSlug({
    applications: applications.flatMap((application) =>
      application.sales_flow_id
        ? [{ id: application.id, sales_flow_id: application.sales_flow_id }]
        : [],
    ),
    eligibleFlows,
    eligibleApplicationFlows: applicationFlows.filter((flow) =>
      eligibleFlowIds.has(flow.id),
    ),
    eligibleDirectFlows: directFlows.filter((flow) =>
      eligibleFlowIds.has(flow.id),
    ),
    primaryFlowId: hasTicketAccess
      ? (eligibleFlows.find((flow) => flow.slug === primaryFlowSlug)?.id ??
        null)
      : null,
  })

  return buildBuyTicketsHref(city?.slug, flowSlug)
}

export default useBuyTicketsHref
