import type { PaymentPortalPublic, SalesFlowPortalPublic } from "@/client"
import type { AttendeePassState, TicketEntry } from "@/types/Attendee"

interface PortalFlowCollections {
  application: SalesFlowPortalPublic[]
  direct: SalesFlowPortalPublic[]
  upsale: SalesFlowPortalPublic[]
  approvedApplicationFlowIds: ReadonlySet<string>
  primaryFlowSlug?: string | null
}

export function getEligiblePortalFlows({
  application,
  direct,
  upsale,
  approvedApplicationFlowIds,
  primaryFlowSlug,
}: PortalFlowCollections): SalesFlowPortalPublic[] {
  const flows = [
    ...application.filter(
      (flow) =>
        approvedApplicationFlowIds.has(flow.id) ||
        flow.slug === primaryFlowSlug,
    ),
    ...direct,
    ...upsale,
  ]
  const seenIds = new Set<string>()
  const seenSlugs = new Set<string>()

  return flows.filter((flow) => {
    if (seenIds.has(flow.id) || seenSlugs.has(flow.slug)) return false
    seenIds.add(flow.id)
    seenSlugs.add(flow.slug)
    return true
  })
}

export function resolvePortalFlowSlug(
  identifier: string,
  flows: Array<{ id: string; slug: string }>,
) {
  return (
    flows.find((flow) => flow.id === identifier || flow.slug === identifier)
      ?.slug ?? null
  )
}

interface PassPurchaseApplication {
  id: string
  sales_flow_id: string
}

interface PassPurchaseFlow {
  id: string
  slug: string
}

interface PassPurchaseFlowResolution {
  explicitFlowIdentifier?: string | null
  attendeeApplicationId?: string | null
  primaryFlowId?: string | null
  applications: PassPurchaseApplication[]
  eligibleFlows: PassPurchaseFlow[]
  eligibleApplicationFlows: PassPurchaseFlow[]
  eligibleDirectFlows: PassPurchaseFlow[]
}

/**
 * Resolves a Passes purchase action without guessing between eligible doors.
 */
export function resolvePassPurchaseFlowSlug({
  explicitFlowIdentifier,
  attendeeApplicationId,
  primaryFlowId,
  applications,
  eligibleFlows,
  eligibleApplicationFlows,
  eligibleDirectFlows,
}: PassPurchaseFlowResolution): string | null {
  if (explicitFlowIdentifier) {
    const explicitFlow = eligibleFlows.find(
      (flow) =>
        flow.id === explicitFlowIdentifier ||
        flow.slug === explicitFlowIdentifier,
    )
    if (explicitFlow) return explicitFlow.slug
  }

  if (attendeeApplicationId) {
    const attendeeApplication = applications.find(
      (application) => application.id === attendeeApplicationId,
    )
    const attendeeFlow = attendeeApplication
      ? eligibleFlows.find(
          (flow) => flow.id === attendeeApplication.sales_flow_id,
        )
      : null
    if (attendeeFlow) return attendeeFlow.slug
  }

  if (primaryFlowId) {
    const primaryFlow = eligibleFlows.find((flow) => flow.id === primaryFlowId)
    if (primaryFlow) return primaryFlow.slug
  }

  if (attendeeApplicationId === null) {
    if (eligibleDirectFlows.length === 1) return eligibleDirectFlows[0].slug
  }

  if (eligibleApplicationFlows.length === 1) {
    return eligibleApplicationFlows[0].slug
  }

  if (
    eligibleApplicationFlows.length === 0 &&
    eligibleDirectFlows.length === 1
  ) {
    return eligibleDirectFlows[0].slug
  }

  return null
}

interface PassesApplication {
  id: string
  sales_flow_id: string
}

type PassesFlow = Pick<SalesFlowPortalPublic, "id" | "name" | "slug">

type PassesPayment = Pick<
  PaymentPortalPublic,
  "application_id" | "id" | "sales_flow_id"
>

interface PassesFlowGroupingInput {
  attendees: AttendeePassState[]
  applications: PassesApplication[]
  eligibleFlows: PassesFlow[]
  payments: PassesPayment[]
  primaryFlowId?: string | null
}

export interface PassesFlowSection {
  flow: PassesFlow
  attendees: AttendeePassState[]
}

export interface PassesFlowGrouping {
  sections: PassesFlowSection[]
  unassignedAttendees: AttendeePassState[]
}

function projectAttendeeTickets(
  attendee: AttendeePassState,
  ticketEntries: TicketEntry[],
): AttendeePassState {
  const productIds = new Set(ticketEntries.map((ticket) => ticket.product_id))
  return {
    ...attendee,
    products: attendee.products.filter((product) => productIds.has(product.id)),
    ticket_entries: ticketEntries,
  }
}

/**
 * Groups Passes records only when the API exposes an authoritative ownership
 * chain. Tickets use their payment's flow when present. Manual assignments
 * can use the attendee's application flow when a BO assignment has no payment
 * ownership chain. Attendees without tickets also use application ownership
 * to find a purchase action.
 */
export function groupPassesBySalesFlow({
  attendees,
  applications,
  eligibleFlows,
  payments,
  primaryFlowId,
}: PassesFlowGroupingInput): PassesFlowGrouping {
  const flowsById = new Map(eligibleFlows.map((flow) => [flow.id, flow]))
  const applicationFlowIds = new Map(
    applications.map((application) => [
      application.id,
      application.sales_flow_id,
    ]),
  )
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment]))
  const attendeesByFlowId = new Map<string, AttendeePassState[]>()
  const unassignedAttendees: AttendeePassState[] = []

  const assign = (flowId: string, attendee: AttendeePassState) => {
    const flowAttendees = attendeesByFlowId.get(flowId) ?? []
    flowAttendees.push(attendee)
    attendeesByFlowId.set(flowId, flowAttendees)
  }

  for (const attendee of attendees) {
    const ticketsByFlowId = new Map<string, TicketEntry[]>()
    const unassignedTickets: TicketEntry[] = []
    const ticketEntries = attendee.ticket_entries ?? []
    const attendeeApplicationFlowId = attendee.application_id
      ? applicationFlowIds.get(attendee.application_id)
      : undefined

    for (const ticket of ticketEntries) {
      let paymentFlowId: string | undefined

      if (ticket.payment_id) {
        const payment = paymentsById.get(ticket.payment_id)
        if (payment?.sales_flow_id) {
          paymentFlowId = flowsById.has(payment.sales_flow_id)
            ? payment.sales_flow_id
            : undefined
        } else if (payment?.application_id) {
          const applicationFlowId = applicationFlowIds.get(
            payment.application_id,
          )
          paymentFlowId =
            applicationFlowId && flowsById.has(applicationFlowId)
              ? applicationFlowId
              : undefined
        }
      }

      const ticketFlowId =
        ticket.payment_id == null
          ? (paymentFlowId ??
            (attendeeApplicationFlowId &&
            flowsById.has(attendeeApplicationFlowId)
              ? attendeeApplicationFlowId
              : primaryFlowId && flowsById.has(primaryFlowId)
                ? primaryFlowId
                : undefined))
          : paymentFlowId

      if (ticketFlowId && flowsById.has(ticketFlowId)) {
        const flowTickets = ticketsByFlowId.get(ticketFlowId) ?? []
        flowTickets.push(ticket)
        ticketsByFlowId.set(ticketFlowId, flowTickets)
      } else {
        unassignedTickets.push(ticket)
      }
    }

    for (const [flowId, flowTickets] of ticketsByFlowId) {
      assign(flowId, projectAttendeeTickets(attendee, flowTickets))
    }

    if (unassignedTickets.length > 0) {
      unassignedAttendees.push(
        projectAttendeeTickets(attendee, unassignedTickets),
      )
    } else if (ticketEntries.length === 0) {
      if (
        attendeeApplicationFlowId &&
        flowsById.has(attendeeApplicationFlowId)
      ) {
        assign(attendeeApplicationFlowId, attendee)
      } else if (primaryFlowId && flowsById.has(primaryFlowId)) {
        assign(primaryFlowId, attendee)
      } else {
        unassignedAttendees.push(attendee)
      }
    }
  }

  return {
    sections: eligibleFlows.flatMap((flow) => {
      const flowAttendees = attendeesByFlowId.get(flow.id)
      return flowAttendees ? [{ flow, attendees: flowAttendees }] : []
    }),
    unassignedAttendees,
  }
}
