import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
    expect(screen.queryByRole("button", { name: /Buy passes/ })).toBeNull()
  })

  it("renders Other passes as a separate section without a purchase action", () => {
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
      "other",
    )
    expect(
      screen.queryByRole("button", { name: "Buy passes passes.other_passes" }),
    ).toBeNull()
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

    render(<HomePasses />)

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
