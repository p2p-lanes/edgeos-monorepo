import { describe, expect, it } from "vitest"
import type { AttendeePassState, TicketEntry } from "@/types/Attendee"
import {
  groupPassesBySalesFlow,
  resolvePassesFlowSelection,
  resolvePassPurchaseFlowSlug,
} from "./portal-sales-flows"

const attendeeFlow = {
  id: "flow-attendee",
  slug: "attendee",
  name: "Attendee",
}
const volunteerFlow = {
  id: "flow-volunteer",
  slug: "volunteer",
  name: "Volunteer",
}
const directFlow = {
  id: "flow-direct",
  slug: "weekend-pass",
  name: "Weekend Pass",
}
const otherDirectFlow = {
  id: "flow-direct-2",
  slug: "day-pass",
  name: "Day Pass",
}

const resolve = (
  overrides: Partial<Parameters<typeof resolvePassPurchaseFlowSlug>[0]> = {},
) =>
  resolvePassPurchaseFlowSlug({
    applications: [
      { id: "application-attendee", sales_flow_id: attendeeFlow.id },
      { id: "application-volunteer", sales_flow_id: volunteerFlow.id },
    ],
    eligibleFlows: [attendeeFlow, volunteerFlow, directFlow],
    eligibleApplicationFlows: [attendeeFlow, volunteerFlow],
    eligibleDirectFlows: [directFlow],
    ...overrides,
  })

describe("resolvePassPurchaseFlowSlug", () => {
  it("prefers a valid explicit eligible flow", () => {
    expect(
      resolve({
        explicitFlowIdentifier: volunteerFlow.id,
        attendeeApplicationId: "application-attendee",
      }),
    ).toBe("volunteer")
  })

  it("ignores an unknown explicit flow and maps the attendee application", () => {
    expect(
      resolve({
        explicitFlowIdentifier: "unknown",
        attendeeApplicationId: "application-attendee",
      }),
    ).toBe("attendee")
  })

  it("uses the only eligible application flow for a popup-wide action", () => {
    expect(
      resolve({
        eligibleFlows: [attendeeFlow, directFlow],
        eligibleApplicationFlows: [attendeeFlow],
      }),
    ).toBe("attendee")
  })

  it("does not choose an application flow when several are eligible", () => {
    expect(resolve()).toBeNull()
  })

  it("uses one unambiguous direct flow for an attendee without an application", () => {
    expect(resolve({ attendeeApplicationId: null })).toBe("weekend-pass")
  })

  it("does not choose a direct flow when several are eligible", () => {
    expect(
      resolve({
        attendeeApplicationId: null,
        eligibleDirectFlows: [directFlow, otherDirectFlow],
      }),
    ).toBeNull()
  })
})

const ticket = (id: string, productId: string, paymentId: string | null) =>
  ({
    id,
    attendee_id: "attendee-direct",
    product_id: productId,
    payment_id: paymentId,
    check_in_code: `code-${id}`,
  }) as TicketEntry

const attendee = (
  id: string,
  applicationId: string | null,
  tickets: TicketEntry[],
) =>
  ({
    id,
    application_id: applicationId,
    products: [
      { id: "product-a", purchased: true },
      { id: "product-b", purchased: true },
      { id: "product-unknown", purchased: true },
    ],
    ticket_entries: tickets,
  }) as AttendeePassState

describe("groupPassesBySalesFlow", () => {
  it("maps an application attendee through application and eligible flow IDs", () => {
    const applicationAttendee = attendee(
      "attendee-application",
      "application-attendee",
      [ticket("ticket-a", "product-a", null)],
    )

    const result = groupPassesBySalesFlow({
      attendees: [applicationAttendee],
      applications: [
        { id: "application-attendee", sales_flow_id: attendeeFlow.id },
      ],
      eligibleFlows: [attendeeFlow, directFlow],
      payments: [],
    })

    expect(result.sections[0].flow).toEqual(attendeeFlow)
    expect(result.sections[0].attendees[0].ticket_entries).toEqual(
      applicationAttendee.ticket_entries,
    )
    expect(result.sections[0].attendees[0].products).toEqual([
      applicationAttendee.products[0],
    ])
    expect(result.unassignedAttendees).toEqual([])
  })

  it("uses ticket payment flow provenance before attendee application ownership", () => {
    const applicationAttendee = attendee(
      "attendee-application",
      "application-attendee",
      [
        ticket("ticket-a", "product-a", null),
        ticket("ticket-b", "product-b", "payment-upsale"),
      ],
    )

    const result = groupPassesBySalesFlow({
      attendees: [applicationAttendee],
      applications: [
        { id: "application-attendee", sales_flow_id: attendeeFlow.id },
      ],
      eligibleFlows: [attendeeFlow, volunteerFlow],
      payments: [
        {
          id: "payment-upsale",
          application_id: "application-attendee",
          sales_flow_id: volunteerFlow.id,
        },
      ],
    })

    expect(result.sections[0].flow).toEqual(attendeeFlow)
    expect(result.sections[0].attendees[0].ticket_entries?.[0].id).toBe(
      "ticket-a",
    )
    expect(result.sections[1].flow).toEqual(volunteerFlow)
    expect(result.sections[1].attendees[0].ticket_entries?.[0].id).toBe(
      "ticket-b",
    )
    expect(result.unassignedAttendees).toEqual([])
  })

  it("splits a direct attendee's tickets by authoritative payment flow", () => {
    const directAttendee = attendee("attendee-direct", null, [
      ticket("ticket-a", "product-a", "payment-a"),
      ticket("ticket-b", "product-b", "payment-b"),
    ])

    const result = groupPassesBySalesFlow({
      attendees: [directAttendee],
      applications: [],
      eligibleFlows: [directFlow, volunteerFlow],
      payments: [
        {
          id: "payment-a",
          application_id: null,
          sales_flow_id: directFlow.id,
        },
        {
          id: "payment-b",
          application_id: null,
          sales_flow_id: volunteerFlow.id,
        },
      ],
    })

    expect(result.sections).toHaveLength(2)
    expect(result.sections[0].attendees[0].ticket_entries).toEqual([
      directAttendee.ticket_entries?.[0],
    ])
    expect(result.sections[0].attendees[0].products).toEqual([
      directAttendee.products[0],
    ])
    expect(result.sections[1].attendees[0].ticket_entries).toEqual([
      directAttendee.ticket_entries?.[1],
    ])
    expect(result.sections[1].attendees[0].products).toEqual([
      directAttendee.products[1],
    ])
    expect(result.unassignedAttendees).toEqual([])
  })

  it("uses an eligible payment application when payment has no flow", () => {
    const directAttendee = attendee("attendee-direct", null, [
      ticket("ticket-a", "product-a", "payment-a"),
    ])

    const result = groupPassesBySalesFlow({
      attendees: [directAttendee],
      applications: [
        { id: "application-attendee", sales_flow_id: attendeeFlow.id },
      ],
      eligibleFlows: [attendeeFlow],
      payments: [
        {
          id: "payment-a",
          application_id: "application-attendee",
          sales_flow_id: null,
        },
      ],
    })

    expect(result.sections[0].flow).toEqual(attendeeFlow)
    expect(result.unassignedAttendees).toEqual([])
  })

  it("does not relabel unresolved payment tickets through attendee application", () => {
    const applicationAttendee = attendee(
      "attendee-application",
      "application-attendee",
      [
        ticket("ticket-missing-payment", "product-a", "payment-missing"),
        ticket("ticket-ineligible-payment", "product-b", "payment-ineligible"),
      ],
    )

    const result = groupPassesBySalesFlow({
      attendees: [applicationAttendee],
      applications: [
        { id: "application-attendee", sales_flow_id: attendeeFlow.id },
      ],
      eligibleFlows: [attendeeFlow],
      payments: [
        {
          id: "payment-ineligible",
          application_id: null,
          sales_flow_id: volunteerFlow.id,
        },
      ],
    })

    expect(result.sections).toEqual([])
    expect(
      result.unassignedAttendees[0].ticket_entries?.map((entry) => entry.id),
    ).toEqual(["ticket-missing-payment", "ticket-ineligible-payment"])
  })

  it("does not fall through from an explicit ineligible payment flow", () => {
    const applicationAttendee = attendee(
      "attendee-application",
      "application-attendee",
      [ticket("ticket-a", "product-a", "payment-a")],
    )

    const result = groupPassesBySalesFlow({
      attendees: [applicationAttendee],
      applications: [
        { id: "application-attendee", sales_flow_id: attendeeFlow.id },
      ],
      eligibleFlows: [attendeeFlow],
      payments: [
        {
          id: "payment-a",
          application_id: "application-attendee",
          sales_flow_id: volunteerFlow.id,
        },
      ],
    })

    expect(result.sections).toEqual([])
    expect(result.unassignedAttendees[0].ticket_entries?.[0].id).toBe(
      "ticket-a",
    )
  })

  it("keeps tickets unassigned when payment provenance is absent or ineligible", () => {
    const directAttendee = attendee("attendee-direct", null, [
      ticket("ticket-a", "product-a", null),
      ticket("ticket-unknown", "product-unknown", "payment-unknown"),
    ])

    const result = groupPassesBySalesFlow({
      attendees: [directAttendee],
      applications: [],
      eligibleFlows: [directFlow],
      payments: [],
    })

    expect(result.sections).toEqual([])
    expect(result.unassignedAttendees[0].ticket_entries).toEqual(
      directAttendee.ticket_entries,
    )
    expect(result.unassignedAttendees[0].products).toEqual([
      directAttendee.products[0],
      directAttendee.products[2],
    ])
  })
})

describe("resolvePassesFlowSelection", () => {
  const attendeePass = attendee("attendee-1", "application-attendee", [])
  const volunteerPass = attendee("attendee-2", "application-volunteer", [])
  const otherPass = attendee("attendee-3", null, [])

  it("renders one available flow directly", () => {
    const result = resolvePassesFlowSelection(
      {
        sections: [{ flow: attendeeFlow, attendees: [attendeePass] }],
        unassignedAttendees: [],
      },
      null,
    )

    expect(result.state).toBe("selected")
    if (result.state !== "selected") return
    expect(result.choice.attendees).toEqual([attendeePass])
    expect(result.canonicalFlowSlug).toBeNull()
  })

  it("canonicalizes a legacy ID when only one flow is available", () => {
    const result = resolvePassesFlowSelection(
      {
        sections: [{ flow: attendeeFlow, attendees: [attendeePass] }],
        unassignedAttendees: [],
      },
      attendeeFlow.id,
    )

    expect(result.state).toBe("selected")
    if (result.state !== "selected") return
    expect(result.canonicalFlowSlug).toBe("attendee")
  })

  it("requires an explicit choice when several projections are available", () => {
    const result = resolvePassesFlowSelection(
      {
        sections: [
          { flow: attendeeFlow, attendees: [attendeePass] },
          { flow: volunteerFlow, attendees: [volunteerPass] },
        ],
        unassignedAttendees: [],
      },
      "unknown",
    )

    expect(result.state).toBe("choose")
    expect(result.choices).toHaveLength(2)
  })

  it("selects by slug and accepts a legacy flow ID for canonicalization", () => {
    const grouping = {
      sections: [
        { flow: attendeeFlow, attendees: [attendeePass] },
        { flow: volunteerFlow, attendees: [volunteerPass] },
      ],
      unassignedAttendees: [],
    }

    const bySlug = resolvePassesFlowSelection(grouping, volunteerFlow.slug)
    const byId = resolvePassesFlowSelection(grouping, volunteerFlow.id)

    expect(bySlug.state).toBe("selected")
    expect(byId.state).toBe("selected")
    if (bySlug.state !== "selected" || byId.state !== "selected") return
    expect(bySlug.choice.attendees).toEqual([volunteerPass])
    expect(bySlug.canonicalFlowSlug).toBeNull()
    expect(byId.choice.attendees).toEqual([volunteerPass])
    expect(byId.canonicalFlowSlug).toBe("volunteer")
  })

  it("offers Other passes as a selectable projection", () => {
    const result = resolvePassesFlowSelection(
      {
        sections: [{ flow: attendeeFlow, attendees: [attendeePass] }],
        unassignedAttendees: [otherPass],
      },
      null,
      true,
    )

    expect(result.state).toBe("selected")
    if (result.state !== "selected") return
    expect(result.choice.kind).toBe("other")
    expect(result.choice.attendees).toEqual([otherPass])
  })

  it("renders an unassigned-only projection directly", () => {
    const result = resolvePassesFlowSelection(
      { sections: [], unassignedAttendees: [otherPass] },
      null,
    )

    expect(result.state).toBe("selected")
    if (result.state !== "selected") return
    expect(result.choice.kind).toBe("other")
  })
})
