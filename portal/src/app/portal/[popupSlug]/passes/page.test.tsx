import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OTHER_PASSES_VIEW } from "@/lib/portal-sales-flows"
import HomePasses from "./page"

const mocks = vi.hoisted(() => ({
  access: { state: "allowed" } as { state: "loading" | "denied" | "allowed" },
  applications: [] as Array<{
    id: string
    sales_flow_id: string
    status: string
  }>,
  applicationFlows: [] as Array<{ id: string; slug: string; name: string }>,
  attendeePasses: [] as Array<{
    id: string
    application_id: string | null
    products: Array<{ id: string; purchased?: boolean }>
    ticket_entries?: Array<{
      id: string
      attendee_id: string
      product_id: string
      payment_id: string | null
      check_in_code: string
      product_name?: string
    }>
  }>,
  attendeesQuery: {
    data: [] as unknown[] | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  city: {
    id: "popup-1",
    slug: "festival",
    takes_applications: true,
  },
  directFlows: [] as Array<{ id: string; slug: string; name: string }>,
  participation: null as null | { type: string },
  payments: [] as Array<{
    id: string
    application_id: string | null
    sales_flow_id: string | null
  }>,
  paymentsLoading: false,
  products: [] as Array<{ id: string }>,
  searchParams: new URLSearchParams(),
  upsaleFlows: [] as Array<{ id: string; slug: string; name: string }>,
}))

const push = vi.fn()
const replace = vi.fn()

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "festival" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/components/CompanionPasses", () => ({
  CompanionPasses: () => <div>companion-passes</div>,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ButtonAnimated: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

vi.mock("@/hooks/useHumanAttendeesQuery", () => ({
  default: () => mocks.attendeesQuery,
}))

vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => mocks.access,
}))

vi.mock("@/hooks/useHumanPaymentsQuery", () => ({
  default: () => ({ data: mocks.payments, isLoading: mocks.paymentsLoading }),
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: mocks.applicationFlows }),
}))

vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: mocks.directFlows }),
}))

vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: mocks.upsaleFlows }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getApplicationsForPopup: () => mocks.applications,
    participation: mocks.participation,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.city }),
}))

vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({
    attendeePasses: mocks.attendeePasses,
    products: mocks.products,
  }),
}))

vi.mock("./Tabs/YourPasses", () => {
  function MockYourPasses({
    attendees,
    onSwitchToBuy,
    salesFlowId,
  }: {
    attendees: Array<{
      id: string
      application_id: string | null
      ticket_entries?: Array<{ id: string; product_name?: string }>
    }>
    onSwitchToBuy?: (attendee?: { application_id: string | null }) => void
    salesFlowId: string | null
  }) {
    const [localStateOpen, setLocalStateOpen] = useState(false)
    return (
      <div>
        <span>your-passes</span>
        <span data-testid="selected-sales-flow">{salesFlowId ?? "other"}</span>
        <button type="button" onClick={() => setLocalStateOpen(true)}>
          Open local state
        </button>
        {localStateOpen && <span>local-state-open</span>}
        {attendees.map((attendee) => (
          <div key={attendee.id}>
            <span>{attendee.id}</span>
            {attendee.ticket_entries?.map((ticket) => (
              <span key={ticket.id}>{ticket.product_name}</span>
            ))}
          </div>
        ))}
        {onSwitchToBuy && (
          <>
            <button type="button" onClick={() => onSwitchToBuy()}>
              Buy passes
            </button>
            <button
              type="button"
              onClick={() => onSwitchToBuy({ application_id: "application-1" })}
            >
              Buy attendee pass
            </button>
          </>
        )}
      </div>
    )
  }

  return { default: MockYourPasses }
})

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

describe("Passes page", () => {
  beforeEach(() => {
    push.mockReset()
    replace.mockReset()
    mocks.access = { state: "allowed" }
    mocks.applications = [
      {
        id: "application-1",
        sales_flow_id: attendeeFlow.id,
        status: "accepted",
      },
    ]
    mocks.applicationFlows = [attendeeFlow]
    mocks.attendeePasses = [
      { id: "attendee-1", application_id: "application-1", products: [] },
    ]
    mocks.attendeesQuery = {
      data: [{ id: "attendee-1" }],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }
    mocks.city = {
      id: "popup-1",
      slug: "festival",
      takes_applications: true,
    }
    mocks.directFlows = []
    mocks.participation = null
    mocks.payments = []
    mocks.paymentsLoading = false
    mocks.products = [{ id: "product-1" }]
    mocks.searchParams = new URLSearchParams()
    mocks.upsaleFlows = []
  })

  it("renders the canonical production Passes experience", () => {
    render(<HomePasses />)

    expect(screen.getByText("your-passes")).toBeTruthy()
    expect(screen.getByText("attendee-1")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Attendee" })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it("canonicalizes a legacy ID for a sole flow", () => {
    mocks.searchParams = new URLSearchParams({ flow: attendeeFlow.id })
    render(<HomePasses />)

    expect(screen.getByTestId("selected-sales-flow").textContent).toBe(
      attendeeFlow.id,
    )
    expect(replace).toHaveBeenCalledWith(
      "/portal/festival/passes?flow=attendee",
    )
  })

  it("maps an attendee application to its eligible Shop flow", () => {
    render(<HomePasses />)

    fireEvent.click(screen.getByRole("button", { name: "Buy attendee pass" }))

    expect(push).toHaveBeenCalledWith("/portal/festival/shop/attendee")
  })

  it("keeps a displayed single-flow purchase action scoped to its owner", () => {
    mocks.applications.push({
      id: "application-2",
      sales_flow_id: volunteerFlow.id,
      status: "accepted",
    })
    mocks.applicationFlows = [attendeeFlow, volunteerFlow]
    mocks.searchParams = new URLSearchParams({ flow: volunteerFlow.id })
    render(<HomePasses />)

    fireEvent.click(screen.getByRole("button", { name: "Buy passes" }))

    expect(push).toHaveBeenCalledWith("/portal/festival/shop/attendee")
  })

  it("shows only the flow selector when several projections are available", () => {
    mocks.applications.push({
      id: "application-2",
      sales_flow_id: volunteerFlow.id,
      status: "accepted",
    })
    mocks.applicationFlows = [attendeeFlow, volunteerFlow]
    mocks.attendeePasses.push({
      id: "attendee-2",
      application_id: "application-2",
      products: [],
    })
    render(<HomePasses />)

    expect(screen.getByRole("button", { name: /Attendee/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Volunteer/ })).toBeTruthy()
    expect(screen.queryByText("your-passes")).toBeNull()
    expect(screen.queryByText("attendee-1")).toBeNull()
    expect(screen.queryByText("attendee-2")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Volunteer/ }))

    expect(push).toHaveBeenCalledWith("/portal/festival/passes?flow=volunteer")
  })

  it("does not choose the first projection for an invalid flow query", () => {
    mocks.applications.push({
      id: "application-2",
      sales_flow_id: volunteerFlow.id,
      status: "accepted",
    })
    mocks.applicationFlows = [attendeeFlow, volunteerFlow]
    mocks.attendeePasses.push({
      id: "attendee-2",
      application_id: "application-2",
      products: [],
    })
    mocks.searchParams = new URLSearchParams({ flow: "unknown" })
    render(<HomePasses />)

    expect(screen.getByRole("button", { name: /Attendee/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Volunteer/ })).toBeTruthy()
    expect(screen.queryByText("your-passes")).toBeNull()
    expect(screen.queryByText("attendee-1")).toBeNull()
  })

  it("renders only the selected direct-sale flow and keeps its Shop action canonical", () => {
    mocks.applications = []
    mocks.applicationFlows = []
    mocks.directFlows = [directFlow]
    mocks.upsaleFlows = [volunteerFlow]
    mocks.products = []
    mocks.attendeePasses = [
      {
        id: "attendee-direct",
        application_id: null,
        products: [
          { id: "product-direct", purchased: true },
          { id: "product-upsale", purchased: true },
        ],
        ticket_entries: [
          {
            id: "ticket-direct",
            attendee_id: "attendee-direct",
            product_id: "product-direct",
            payment_id: "payment-direct",
            check_in_code: "direct-code",
            product_name: "Weekend ticket",
          },
          {
            id: "ticket-upsale",
            attendee_id: "attendee-direct",
            product_id: "product-upsale",
            payment_id: "payment-upsale",
            check_in_code: "upsale-code",
            product_name: "Volunteer ticket",
          },
        ],
      },
    ]
    mocks.payments = [
      {
        id: "payment-direct",
        application_id: null,
        sales_flow_id: directFlow.id,
      },
      {
        id: "payment-upsale",
        application_id: null,
        sales_flow_id: volunteerFlow.id,
      },
    ]
    mocks.searchParams = new URLSearchParams({ flow: directFlow.slug })
    render(<HomePasses />)

    expect(screen.getByText("Weekend ticket")).toBeTruthy()
    expect(screen.queryByText("Volunteer ticket")).toBeNull()
    expect(screen.getByTestId("selected-sales-flow").textContent).toBe(
      directFlow.id,
    )
    fireEvent.click(screen.getByRole("button", { name: "Buy passes" }))
    expect(push).toHaveBeenCalledWith("/portal/festival/shop/weekend-pass")
  })

  it("remounts flow-local state when the selected flow changes", () => {
    mocks.applications = []
    mocks.applicationFlows = []
    mocks.directFlows = [directFlow]
    mocks.upsaleFlows = [volunteerFlow]
    mocks.attendeePasses = [
      {
        id: "shared-attendee",
        application_id: null,
        products: [{ id: "shared-product", purchased: true }],
        ticket_entries: [
          {
            id: "ticket-direct",
            attendee_id: "shared-attendee",
            product_id: "shared-product",
            payment_id: "payment-direct",
            check_in_code: "direct-code",
            product_name: "Direct ticket",
          },
          {
            id: "ticket-volunteer",
            attendee_id: "shared-attendee",
            product_id: "shared-product",
            payment_id: "payment-volunteer",
            check_in_code: "volunteer-code",
            product_name: "Volunteer ticket",
          },
        ],
      },
    ]
    mocks.payments = [
      {
        id: "payment-direct",
        application_id: null,
        sales_flow_id: directFlow.id,
      },
      {
        id: "payment-volunteer",
        application_id: null,
        sales_flow_id: volunteerFlow.id,
      },
    ]
    mocks.searchParams = new URLSearchParams({ flow: directFlow.slug })
    const { rerender } = render(<HomePasses />)

    fireEvent.click(screen.getByRole("button", { name: "Open local state" }))
    expect(screen.getByText("local-state-open")).toBeTruthy()

    mocks.searchParams = new URLSearchParams({ flow: volunteerFlow.slug })
    rerender(<HomePasses />)

    expect(screen.getByTestId("selected-sales-flow").textContent).toBe(
      volunteerFlow.id,
    )
    expect(screen.queryByText("local-state-open")).toBeNull()
  })

  it("renders unassigned-only passes directly without a purchase action", () => {
    mocks.applications = []
    mocks.applicationFlows = []
    mocks.directFlows = [directFlow]
    mocks.attendeePasses = [
      {
        id: "attendee-direct",
        application_id: null,
        products: [{ id: "product-direct", purchased: true }],
        ticket_entries: [
          {
            id: "ticket-direct",
            attendee_id: "attendee-direct",
            product_id: "product-direct",
            payment_id: null,
            check_in_code: "direct-code",
            product_name: "Historical ticket",
          },
        ],
      },
    ]
    render(<HomePasses />)

    expect(screen.getByText("Historical ticket")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Buy passes" })).toBeNull()
  })

  it("offers Other passes as a separate choice without rendering pass cards", () => {
    mocks.directFlows = [directFlow]
    mocks.attendeePasses.push({
      id: "attendee-direct",
      application_id: null,
      products: [],
      ticket_entries: [
        {
          id: "ticket-unassigned",
          attendee_id: "attendee-direct",
          product_id: "product-unassigned",
          payment_id: null,
          check_in_code: "unassigned-code",
          product_name: "Unassigned ticket",
        },
      ],
    })
    render(<HomePasses />)

    expect(screen.getByRole("button", { name: /Attendee/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /passes.other_passes/ }))
    expect(screen.queryByText("attendee-1")).toBeNull()
    expect(screen.queryByText("Unassigned ticket")).toBeNull()
    expect(push).toHaveBeenCalledWith(
      `/portal/festival/passes?view=${OTHER_PASSES_VIEW}`,
    )
  })

  it("renders a selected Other passes projection without a purchase action", () => {
    mocks.directFlows = [directFlow]
    mocks.attendeePasses.push({
      id: "attendee-direct",
      application_id: null,
      products: [],
      ticket_entries: [
        {
          id: "ticket-unassigned",
          attendee_id: "attendee-direct",
          product_id: "product-unassigned",
          payment_id: null,
          check_in_code: "unassigned-code",
          product_name: "Unassigned ticket",
        },
      ],
    })
    mocks.searchParams = new URLSearchParams({
      view: OTHER_PASSES_VIEW,
    })
    render(<HomePasses />)

    expect(screen.getByText("Unassigned ticket")).toBeTruthy()
    expect(screen.getByTestId("selected-sales-flow").textContent).toBe("other")
    expect(screen.queryByText("attendee-1")).toBeNull()
    expect(screen.queryByRole("button", { name: "Buy passes" })).toBeNull()
  })

  it("accepts a legacy flow ID and replaces it with the canonical slug", () => {
    mocks.applications.push({
      id: "application-2",
      sales_flow_id: volunteerFlow.id,
      status: "accepted",
    })
    mocks.applicationFlows = [attendeeFlow, volunteerFlow]
    mocks.attendeePasses.push({
      id: "attendee-2",
      application_id: "application-2",
      products: [],
    })
    mocks.searchParams = new URLSearchParams({ flow: volunteerFlow.id })
    render(<HomePasses />)

    expect(screen.getByText("attendee-2")).toBeTruthy()
    expect(screen.queryByText("attendee-1")).toBeNull()
    expect(replace).toHaveBeenCalledWith(
      "/portal/festival/passes?flow=volunteer",
    )
  })

  it("routes a direct-sale empty-state action through its one eligible Shop flow", () => {
    mocks.access = { state: "denied" }
    mocks.applications = []
    mocks.applicationFlows = []
    mocks.attendeePasses = []
    mocks.attendeesQuery.data = []
    mocks.city.takes_applications = false
    mocks.directFlows = [directFlow]
    render(<HomePasses />)

    fireEvent.click(screen.getByRole("button", { name: "cta.buy_tickets" }))

    expect(push).toHaveBeenCalledWith("/portal/festival/shop/weekend-pass")
  })

  it("keeps rendering retained passes after a background attendee refetch fails", () => {
    mocks.attendeesQuery.isError = true
    render(<HomePasses />)

    expect(screen.getByText("your-passes")).toBeTruthy()
    expect(screen.queryByText("passes.error_title")).toBeNull()
  })
})
