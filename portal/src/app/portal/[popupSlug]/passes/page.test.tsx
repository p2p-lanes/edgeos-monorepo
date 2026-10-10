import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PersonalTicketsPublic } from "@/client"
import HomePasses from "./page"

const mocks = vi.hoisted(() => ({
  access: { state: "allowed" } as
    | {
        state: "allowed"
        source?: "application" | "attendee" | "payment" | "companion"
      }
    | { state: "loading" | "denied" },
  applications: [] as Array<{
    id: string
    sales_flow_id: string
    status: string
  }>,
  applicationFlows: [] as Array<{ id: string; slug: string; name: string }>,
  attendeePasses: [] as Array<{
    id: string
    application_id: string | null
    email?: string
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
  primaryFlowSlug: null as string | null,
  personalTicketsQuery: {
    data: [] as PersonalTicketsPublic[] | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  payments: [] as Array<{
    id: string
    application_id: string | null
    sales_flow_id: string | null
    status?: string
    products_snapshot?: Array<{
      product_id: string
      attendee_id: string | null
      product_name: string
      product_price: string
      product_category: string
      product_currency: string
      quantity: number
      created_at: string
      units?: Array<{
        id: string
        check_in_code: string
        active: boolean
        requires_check_in: boolean
      }>
    }>
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

vi.mock("@/hooks/useMyTicketsQuery", () => ({
  default: () => mocks.personalTicketsQuery,
}))

vi.mock("./components/common/QRcode", () => ({
  default: ({
    isOpen,
    check_in_code,
  }: {
    isOpen: boolean
    check_in_code: string
  }) => (isOpen ? <div role="dialog">{check_in_code}</div> : null),
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

vi.mock("@/hooks/usePortalPrimarySalesFlow", () => ({
  usePortalPrimarySalesFlow: () => ({
    data: mocks.primaryFlowSlug
      ? { flow_slug: mocks.primaryFlowSlug }
      : undefined,
    isLoading: false,
  }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getApplicationsForPopup: () => mocks.applications,
    participation: mocks.participation,
  }),
}))

vi.mock("@/client", () => ({
  TicketingStepsService: {
    listPortalTicketingSteps: vi.fn(async () => ({ results: [] })),
  },
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
    sectionTitle,
  }: {
    attendees: Array<{
      id: string
      application_id: string | null
      ticket_entries?: Array<{ id: string; product_name?: string }>
    }>
    onSwitchToBuy?: (attendee?: { application_id: string | null }) => void
    salesFlowId: string | null
    sectionTitle?: string
  }) {
    return (
      <div>
        {sectionTitle && <h2>{sectionTitle}</h2>}
        <span data-testid="selected-sales-flow">{salesFlowId ?? "other"}</span>
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
            <button
              type="button"
              onClick={() => onSwitchToBuy()}
              aria-label={`Buy passes ${sectionTitle ?? salesFlowId}`}
            >
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
      {
        id: "attendee-1",
        application_id: "application-1",
        email: "jon@example.com",
        products: [],
      },
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
    mocks.primaryFlowSlug = null
    mocks.payments = []
    mocks.paymentsLoading = false
    mocks.personalTicketsQuery = {
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }
    mocks.products = [{ id: "product-1" }]
    mocks.searchParams = new URLSearchParams()
    mocks.upsaleFlows = []
  })

  const spouseTicket = (): PersonalTicketsPublic => ({
    id: "unlinked-spouse",
    name: "Jon Spouse",
    email: "jon@example.com",
    category: "spouse",
    popup_id: "popup-1",
    popup_name: "Festival",
    products: [{ name: "Spouse pass", category: "ticket", quantity: 1 }],
    tickets: [
      {
        id: "spouse-unit",
        attendee_id: "unlinked-spouse",
        product_id: "spouse-product",
        product_name: "Spouse pass",
        product_category_snapshot: "ticket",
        requires_check_in: true,
        check_in_code: "SPOUSEQR",
      },
    ],
  })

  it("shows an unlinked spouse ticket and QR without offering attendee management or a replacement pass", () => {
    mocks.personalTicketsQuery.data = [spouseTicket()]
    render(<HomePasses />)

    expect(screen.getByText("Spouse pass")).toBeTruthy()
    expect(screen.getByText("Jon Spouse")).toBeTruthy()
    expect(screen.queryByText("attendee-1")).toBeNull()
    expect(screen.queryByRole("button", { name: /Buy passes/ })).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "passes.check_in_code" }),
    )
    expect(screen.getByRole("dialog").textContent).toBe("SPOUSEQR")
    expect(replace).not.toHaveBeenCalled()
  })

  it("keeps ticketless companions with another email in the management projection", () => {
    mocks.personalTicketsQuery.data = [spouseTicket()]
    mocks.attendeePasses.push({
      id: "ticketless-child",
      email: "child@example.com",
      application_id: "application-1",
      products: [],
    })
    render(<HomePasses />)
    expect(screen.getByText("Spouse pass")).toBeTruthy()
    expect(screen.getByText("ticketless-child")).toBeTruthy()
    expect(screen.queryByText("attendee-1")).toBeNull()
  })

  it("does not duplicate personal tickets already represented by the normal attendee view", () => {
    mocks.attendeesQuery.data = [{ id: "unlinked-spouse" }]
    mocks.personalTicketsQuery.data = [spouseTicket()]
    render(<HomePasses />)
    expect(screen.queryByText("passes.assigned_tickets")).toBeNull()
    expect(screen.getByText("attendee-1")).toBeTruthy()
  })

  it("does not display tickets from another popup", () => {
    mocks.personalTicketsQuery.data = [
      { ...spouseTicket(), popup_id: "other-popup" },
    ]
    render(<HomePasses />)
    expect(screen.queryByText("Spouse pass")).toBeNull()
    expect(screen.getByText("attendee-1")).toBeTruthy()
  })

  it("waits for the personal ticket read before redirecting a denied account", () => {
    mocks.access = { state: "denied" }
    mocks.personalTicketsQuery.isLoading = true
    render(<HomePasses />)
    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it("shows only read-only personal tickets when general popup access is denied", () => {
    mocks.access = { state: "denied" }
    mocks.personalTicketsQuery.data = [spouseTicket()]
    render(<HomePasses />)
    expect(screen.getByText("Spouse pass")).toBeTruthy()
    expect(screen.queryByText("attendee-1")).toBeNull()
    expect(screen.queryByRole("button", { name: /Buy/ })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it("keeps managed passes usable and offers retry if the supplemental read fails", () => {
    mocks.personalTicketsQuery.data = undefined
    mocks.personalTicketsQuery.isError = true
    render(<HomePasses />)
    expect(screen.getByText("attendee-1")).toBeTruthy()
    expect(screen.getByRole("alert")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "passes.error_retry" }))
    expect(mocks.personalTicketsQuery.refetch).toHaveBeenCalledOnce()
  })

  it("does not redirect or claim no tickets on a failed denied-account read", () => {
    mocks.access = { state: "denied" }
    mocks.personalTicketsQuery.data = undefined
    mocks.personalTicketsQuery.isError = true
    render(<HomePasses />)
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it("keeps cached personal tickets visible after a background refetch error", () => {
    mocks.personalTicketsQuery.data = [spouseTicket()]
    mocks.personalTicketsQuery.isError = true
    render(<HomePasses />)
    expect(screen.getByText("Spouse pass")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("renders the canonical production Passes experience", () => {
    render(<HomePasses />)

    expect(screen.getByText("passes.your_purchases")).toBeTruthy()
    expect(screen.getByText("attendee-1")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Attendee" })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it("keeps legacy flow URLs on the unified passes screen", () => {
    mocks.searchParams = new URLSearchParams({ flow: attendeeFlow.id })
    render(<HomePasses />)

    expect(screen.getByTestId("selected-sales-flow").textContent).toBe(
      attendeeFlow.id,
    )
    expect(replace).not.toHaveBeenCalled()
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

    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes flow-attendee" }),
    )

    expect(push).toHaveBeenCalledWith("/portal/festival/shop/attendee")
  })

  it("renders every flow on one screen with a scoped purchase action", () => {
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

    expect(screen.getByRole("heading", { name: "Attendee" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Volunteer" })).toBeTruthy()
    expect(screen.getByText("passes.your_purchases")).toBeTruthy()
    expect(screen.getByText("attendee-1")).toBeTruthy()
    expect(screen.getByText("attendee-2")).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes Volunteer" }),
    )

    expect(push).toHaveBeenCalledWith("/portal/festival/shop/volunteer")
  })

  it("shows every projection when an obsolete flow query is invalid", () => {
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

    expect(screen.getByRole("heading", { name: "Attendee" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Volunteer" })).toBeTruthy()
    expect(screen.getByText("attendee-1")).toBeTruthy()
    expect(screen.getByText("attendee-2")).toBeTruthy()
  })

  it("renders all direct and upsale passes with canonical Shop actions", () => {
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
    expect(screen.getByText("Volunteer ticket")).toBeTruthy()
    expect(screen.getAllByTestId("selected-sales-flow")).toHaveLength(2)
    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes Weekend Pass" }),
    )
    expect(push).toHaveBeenCalledWith("/portal/festival/shop/weekend-pass")
    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes Volunteer" }),
    )
    expect(push).toHaveBeenCalledWith("/portal/festival/shop/volunteer")
  })

  it("offers the only eligible direct flow for a manually assigned ticket", () => {
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
    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes flow-direct" }),
    )
    expect(push).toHaveBeenCalledWith("/portal/festival/shop/weekend-pass")
  })

  it("keeps unassigned tickets without an eligible purchase flow read-only", () => {
    mocks.applications = []
    mocks.products = []
    mocks.participation = { type: "none" }
    mocks.attendeePasses = [
      {
        id: "invited-attendee",
        application_id: null,
        products: [],
        ticket_entries: [
          {
            id: "assigned-ticket",
            attendee_id: "invited-attendee",
            product_id: "assigned-product",
            payment_id: null,
            check_in_code: "INVITEDQR",
            product_name: "Assigned ticket",
          },
        ],
      },
    ]
    mocks.attendeesQuery.data = [{ id: "invited-attendee" }]

    render(<HomePasses />)

    expect(screen.getByText("Assigned ticket")).toBeTruthy()
    expect(screen.getByTestId("selected-sales-flow").textContent).toBe("other")
    expect(screen.queryByRole("button", { name: /Buy passes/ })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it("uses an approved application flow for a ticket granted from backoffice", () => {
    mocks.attendeePasses = [
      {
        id: "granted-attendee",
        application_id: "application-1",
        products: [{ id: "product-1", purchased: true }],
        ticket_entries: [
          {
            id: "granted-ticket",
            attendee_id: "granted-attendee",
            product_id: "product-1",
            payment_id: null,
            check_in_code: "GRANTEDQR",
            product_name: "Backoffice-granted ticket",
          },
        ],
      },
    ]

    render(<HomePasses />)

    expect(screen.getByTestId("selected-sales-flow").textContent).toBe(
      attendeeFlow.id,
    )
    expect(screen.getByText("Backoffice-granted ticket")).toBeTruthy()
    expect(
      screen.queryByRole("heading", { name: "passes.other_passes" }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes flow-attendee" }),
    )
    expect(push).toHaveBeenCalledWith("/portal/festival/shop/attendee")
  })

  it("uses the popup primary flow for a backoffice-granted ticket without an application", () => {
    mocks.access = { state: "allowed", source: "attendee" }
    mocks.applications = []
    mocks.applicationFlows = [attendeeFlow]
    mocks.primaryFlowSlug = attendeeFlow.slug
    mocks.attendeePasses = [
      {
        id: "granted-attendee-no-application",
        application_id: null,
        products: [{ id: "product-1", purchased: true }],
        ticket_entries: [
          {
            id: "granted-ticket-no-application",
            attendee_id: "granted-attendee-no-application",
            product_id: "product-1",
            payment_id: null,
            check_in_code: "GRANTEDQR",
            product_name: "Backoffice-granted ticket",
          },
        ],
      },
    ]

    render(<HomePasses />)

    expect(screen.getByTestId("selected-sales-flow").textContent).toBe(
      attendeeFlow.id,
    )
    expect(screen.getByText("Backoffice-granted ticket")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes flow-attendee" }),
    )
    expect(push).toHaveBeenCalledWith("/portal/festival/shop/attendee")
  })

  it("offers the sole eligible direct flow for unassigned tickets", () => {
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

    expect(screen.getByRole("heading", { name: "Attendee" })).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "passes.other_passes" }),
    ).toBeTruthy()
    expect(screen.getByText("attendee-1")).toBeTruthy()
    expect(screen.getByText("Unassigned ticket")).toBeTruthy()
    expect(screen.getAllByTestId("selected-sales-flow")[1].textContent).toBe(
      directFlow.id,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Buy passes passes.other_passes" }),
    )
    expect(push).toHaveBeenCalledWith("/portal/festival/shop/weekend-pass")
  })

  it("shows approved ownerless products below passes and links to Payments", () => {
    mocks.access = { state: "denied" }
    mocks.applications = []
    mocks.applicationFlows = []
    mocks.attendeePasses = []
    mocks.attendeesQuery.data = []
    mocks.city.takes_applications = false
    mocks.directFlows = [directFlow]
    mocks.products = []
    mocks.payments = [
      {
        id: "payment-merch",
        application_id: null,
        sales_flow_id: directFlow.id,
        status: "approved",
        products_snapshot: [
          {
            product_id: "event-shirt",
            attendee_id: null,
            product_name: "Event shirt",
            product_price: "25",
            product_category: "merch",
            product_currency: "USD",
            quantity: 1,
            created_at: "2026-09-11T12:00:00Z",
            units: [
              {
                id: "shirt-unit",
                check_in_code: "shirt-code",
                active: true,
                requires_check_in: false,
              },
            ],
          },
        ],
      },
    ]

    render(
      <QueryClientProvider client={new QueryClient()}>
        <HomePasses />
      </QueryClientProvider>,
    )

    expect(screen.getByText("passes.your_purchases")).toBeTruthy()
    expect(screen.getByText("passes.other_products")).toBeTruthy()
    expect(screen.getByText("Event shirt")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: /passes.view_payment_details/ })
        .getAttribute("href"),
    ).toBe("/portal/festival/orders")
  })

  it("does not let a legacy flow ID hide other pass groups", () => {
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

    expect(screen.getByText("attendee-1")).toBeTruthy()
    expect(screen.getByText("attendee-2")).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
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

    expect(screen.getByText("passes.your_purchases")).toBeTruthy()
    expect(screen.queryByText("passes.error_title")).toBeNull()
  })
})
