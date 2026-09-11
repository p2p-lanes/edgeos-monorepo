import type { PaymentPublic, SalesFlowPortalPublic } from "@/client"
import type { AttendeePassState, TicketEntry } from "@/types/Attendee"

interface PortalFlowCollections {
  application: SalesFlowPortalPublic[]
  direct: SalesFlowPortalPublic[]
  upsale: SalesFlowPortalPublic[]
  approvedApplicationFlowIds: ReadonlySet<string>
}

export function getEligiblePortalFlows({
  application,
  direct,
  upsale,
  approvedApplicationFlowIds,
}: PortalFlowCollections): SalesFlowPortalPublic[] {
  const flows = [
    ...application.filter((flow) => approvedApplicationFlowIds.has(flow.id)),
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

  if (attendeeApplicationId === null) {
    return eligibleDirectFlows.length === 1 ? eligibleDirectFlows[0].slug : null
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
  PaymentPublic,
  "application_id" | "id" | "sales_flow_id"
>

interface PassesFlowGroupingInput {
  attendees: AttendeePassState[]
  applications: PassesApplication[]
  eligibleFlows: PassesFlow[]
  payments: PassesPayment[]
}

export interface PassesFlowSection {
  flow: PassesFlow
  attendees: AttendeePassState[]
}

export interface PassesFlowGrouping {
  sections: PassesFlowSection[]
  unassignedAttendees: AttendeePassState[]
}

export const OTHER_PASSES_VIEW = "other-passes"
const OTHER_PASSES_CHOICE_IDENTIFIER = "other"

export type PassesFlowChoice =
  | {
      kind: "flow"
      identifier: string
      flow: PassesFlow
      attendees: AttendeePassState[]
    }
  | {
      kind: "other"
      identifier: typeof OTHER_PASSES_CHOICE_IDENTIFIER
      attendees: AttendeePassState[]
    }

export type PassesFlowSelection =
  | { state: "empty"; choices: [] }
  | { state: "choose"; choices: PassesFlowChoice[] }
  | {
      state: "selected"
      choices: PassesFlowChoice[]
      choice: PassesFlowChoice
      canonicalFlowSlug: string | null
    }

/**
 * Resolves one visible Passes projection without guessing when several
 * ownership buckets are available. Flow IDs remain accepted for old URLs,
 * while newly generated URLs use the flow slug.
 */
export function resolvePassesFlowSelection(
  grouping: PassesFlowGrouping,
  flowIdentifier: string | null,
  selectOtherPasses = false,
): PassesFlowSelection {
  const choices: PassesFlowChoice[] = grouping.sections.map(
    ({ flow, attendees }) => ({
      kind: "flow",
      identifier: `flow:${flow.id}`,
      flow,
      attendees,
    }),
  )

  if (grouping.unassignedAttendees.length > 0) {
    choices.push({
      kind: "other",
      identifier: OTHER_PASSES_CHOICE_IDENTIFIER,
      attendees: grouping.unassignedAttendees,
    })
  }

  if (choices.length === 0) return { state: "empty", choices: [] }

  if (choices.length === 1) {
    const [choice] = choices
    return {
      state: "selected",
      choices,
      choice,
      canonicalFlowSlug:
        choice.kind === "flow" && flowIdentifier === choice.flow.id
          ? choice.flow.slug
          : null,
    }
  }

  const choice = selectOtherPasses
    ? choices.find((candidate) => candidate.kind === "other")
    : choices.find(
        (candidate) =>
          candidate.kind === "flow" &&
          (candidate.flow.id === flowIdentifier ||
            candidate.flow.slug === flowIdentifier),
      )

  if (!choice) return { state: "choose", choices }

  return {
    state: "selected",
    choices,
    choice,
    canonicalFlowSlug:
      choice.kind === "flow" && flowIdentifier === choice.flow.id
        ? choice.flow.slug
        : null,
  }
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
 * chain. Tickets use their payment's flow when present, while tickets without
 * payment provenance and attendees without tickets use attendee application
 * ownership. Records without a resolvable eligible flow remain unassigned.
 */
export function groupPassesBySalesFlow({
  attendees,
  applications,
  eligibleFlows,
  payments,
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
      } else if (
        attendeeApplicationFlowId &&
        flowsById.has(attendeeApplicationFlowId)
      ) {
        paymentFlowId = attendeeApplicationFlowId
      }

      if (paymentFlowId && flowsById.has(paymentFlowId)) {
        const flowTickets = ticketsByFlowId.get(paymentFlowId) ?? []
        flowTickets.push(ticket)
        ticketsByFlowId.set(paymentFlowId, flowTickets)
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
