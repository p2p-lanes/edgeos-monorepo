import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { dedupTicketEntries } from "@/app/portal/[popupSlug]/passes/utils/dedupTickets"
import { TicketingStepsService } from "@/client"
import { groupPassesBySalesFlow } from "@/lib/portal-sales-flows"
import type { AttendeePassState } from "@/types/Attendee"
import YourPasses from "./YourPasses"

interface QueryConfiguration {
  enabled: boolean
  queryFn: () => Promise<unknown>
  queryKey: unknown[]
}

const queryConfigurations = vi.hoisted(() => [] as QueryConfiguration[])
const queryResult = vi.hoisted(() => ({ data: undefined as unknown }))
const productsQueryResult = vi.hoisted(() => ({ data: [] as unknown[] }))
const productsQuery = vi.hoisted(() =>
  vi.fn(() => ({ data: productsQueryResult.data })),
)

vi.mock("@tanstack/react-query", () => ({
  useQuery: (configuration: QueryConfiguration) => {
    queryConfigurations.push(configuration)
    return { data: queryResult.data }
  },
}))

vi.mock("@/hooks/useProductsQuery", () => ({
  useProductsQuery: productsQuery,
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/components/checkout-flow/shared/AddAttendeeButtons", () => ({
  default: () => <span>add-attendee-actions</span>,
}))

vi.mock("@/hooks/useAttendee", () => ({
  default: () => ({
    addAttendee: vi.fn(),
    editAttendee: vi.fn(),
    removeAttendee: vi.fn(),
  }),
}))

vi.mock("@/hooks/useAttendeeCategories", () => ({
  useAttendeeCategories: () => ({ categories: [] }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", status: "active" }),
  }),
}))

vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({ attendeePasses: [], products: [] }),
}))

vi.mock("../hooks/useModal", () => ({
  default: () => ({
    handleCloseModal: vi.fn(),
    handleDelete: vi.fn(),
    handleEdit: vi.fn(),
    modal: { isOpen: false, category: null },
  }),
}))

const attendee = (ticketId: string, productName: string) =>
  ({
    id: "mixed-attendee",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    application_id: null,
    name: "Mixed attendee",
    category: "main",
    products: [],
    ticket_entries: [
      {
        id: ticketId,
        attendee_id: "mixed-attendee",
        product_id: `product-${ticketId}`,
        payment_id: `payment-${ticketId}`,
        check_in_code: `code-${ticketId}`,
        product_name: productName,
        product_category: "ticket",
        requires_check_in: false,
      },
    ],
  }) as AttendeePassState

describe("YourPasses selected projection", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    queryConfigurations.length = 0
    queryResult.data = undefined
    productsQueryResult.data = []
    productsQuery.mockClear()
  })

  it("renders the supplied attendee subset with its scoped purchase action", () => {
    const buyPasses = vi.fn()

    render(
      <YourPasses
        access={{ state: "allowed", source: "attendee" }}
        attendees={[attendee("attendee-pass", "Attendee ticket")]}
        onSwitchToBuy={buyPasses}
        salesFlowId="flow-attendee"
      />,
    )

    expect(screen.getByText("Attendee ticket")).toBeTruthy()
    fireEvent.click(
      screen.getAllByRole("button", { name: "passes.buy_passes" })[0],
    )
    expect(buyPasses).toHaveBeenCalledWith()
  })

  it("scopes catalog and ticketing-step queries to the selected flow", async () => {
    const ticketingSteps = vi
      .spyOn(TicketingStepsService, "listPortalTicketingSteps")
      .mockResolvedValue({ results: [], count: 0 })

    render(
      <YourPasses
        access={{ state: "allowed", source: "attendee" }}
        attendees={[attendee("attendee-pass", "Attendee ticket")]}
        salesFlowId="flow-attendee"
      />,
    )

    expect(productsQuery).toHaveBeenCalledTimes(1)
    for (const call of productsQuery.mock.calls) {
      expect(call).toEqual(["popup-1", "flow-attendee", true])
    }
    expect(queryConfigurations).toHaveLength(2)
    for (const configuration of queryConfigurations) {
      expect(configuration.queryKey).toEqual([
        "ticketing-steps-portal",
        "popup-1",
        "flow-attendee",
      ])
      expect(configuration.enabled).toBe(true)
      await configuration.queryFn()
    }
    expect(ticketingSteps).toHaveBeenCalledTimes(2)
    expect(ticketingSteps).toHaveBeenCalledWith({
      popupId: "popup-1",
      salesFlowId: "flow-attendee",
    })
  })

  it("ignores cached default-flow enrichment for Other passes", () => {
    productsQueryResult.data = [
      {
        id: "product-other-pass",
        name: "Cached default meal plan",
        price: 100,
        category: "meal_plan",
        sale_starts_at: null,
        sale_ends_at: null,
        sold_out_override: false,
        total_stock_cap: null,
        total_stock_remaining: null,
      },
    ]
    queryResult.data = {
      results: [
        {
          template: "meal-plan-select",
          template_config: {
            sections: [
              {
                products: [
                  {
                    product_id: "product-other-pass",
                    coverage_start: "2026-10-01",
                    coverage_end: "2026-10-07",
                  },
                ],
              },
            ],
          },
        },
      ],
    }
    const buyPasses = vi.fn()
    const historicalAccommodation = {
      ...attendee("historical-room", "Current room name"),
      id: "historical-attendee",
      ticket_entries: [
        {
          id: "historical-room",
          attendee_id: "historical-attendee",
          product_id: "historical-room-product",
          payment_id: "historical-payment",
          check_in_code: "historical-code",
          product_name: "Current room name",
          product_category: "housing",
          requires_check_in: false,
          purchase_metadata: {
            kind: "accommodation_booking",
            accommodation_name: "Historical Suite",
            check_in: "2026-10-01",
            check_out: "2026-10-03",
            quote: { total: "321", currency: "USD" },
          },
        },
      ],
    } as AttendeePassState

    render(
      <YourPasses
        access={{ state: "allowed", source: "attendee" }}
        attendees={[
          attendee("other-pass", "Historical ticket"),
          historicalAccommodation,
        ]}
        onSwitchToBuy={buyPasses}
        salesFlowId={null}
      />,
    )

    expect(screen.getByText("Historical ticket")).toBeTruthy()
    expect(screen.getByText("Historical Suite")).toBeTruthy()
    expect(screen.getByText("$321")).toBeTruthy()
    expect(productsQuery).toHaveBeenCalledTimes(1)
    for (const call of productsQuery.mock.calls) {
      expect(call).toEqual(["popup-1", null, false])
    }
    expect(queryConfigurations).toHaveLength(3)
    expect(
      queryConfigurations.every((configuration) => !configuration.enabled),
    ).toBe(true)
    expect(screen.queryByRole("button", { name: "Edit meal plan" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "passes.buy_passes" }),
    ).toBeNull()
    expect(buyPasses).not.toHaveBeenCalled()
  })

  it("renders same-product physical tickets once inside their owning flow", () => {
    const ticketEntries = dedupTicketEntries([
      {
        id: "ticket-attendee",
        attendee_id: "mixed-attendee",
        product_id: "shared-room",
        payment_id: "payment-attendee",
        check_in_code: "code-attendee",
        product_name: "Current room name",
        product_category: "housing",
        requires_check_in: false,
        purchase_metadata: {
          kind: "accommodation_booking",
          accommodation_name: "Attendee Suite",
          check_in: "2026-10-01",
          check_out: "2026-10-03",
          quote: { total: "111", currency: "USD" },
        },
      },
      {
        id: "ticket-volunteer",
        attendee_id: "mixed-attendee",
        product_id: "shared-room",
        payment_id: "payment-volunteer",
        check_in_code: "code-volunteer",
        product_name: "Current room name",
        product_category: "housing",
        requires_check_in: false,
        purchase_metadata: {
          kind: "accommodation_booking",
          accommodation_name: "Volunteer Cabin",
          check_in: "2026-10-04",
          check_out: "2026-10-06",
          quote: { total: "222", currency: "USD" },
        },
      },
    ])
    const mixedAttendee = {
      ...attendee("unused", "unused"),
      ticket_entries: ticketEntries,
    }
    const grouping = groupPassesBySalesFlow({
      attendees: [mixedAttendee],
      applications: [],
      eligibleFlows: [
        { id: "flow-attendee", slug: "attendee", name: "Attendee" },
        { id: "flow-volunteer", slug: "volunteer", name: "Volunteer" },
      ],
      payments: [
        {
          id: "payment-attendee",
          application_id: null,
          sales_flow_id: "flow-attendee",
        },
        {
          id: "payment-volunteer",
          application_id: null,
          sales_flow_id: "flow-volunteer",
        },
      ],
    })

    const { rerender } = render(
      <YourPasses
        access={{ state: "allowed", source: "attendee" }}
        attendees={grouping.sections[0].attendees}
        salesFlowId="flow-attendee"
      />,
    )

    expect(screen.getByText("Attendee Suite")).toBeTruthy()
    expect(screen.getByText("$111")).toBeTruthy()
    expect(screen.queryByText("Volunteer Cabin")).toBeNull()
    expect(screen.queryByText("$222")).toBeNull()

    rerender(
      <YourPasses
        access={{ state: "allowed", source: "attendee" }}
        attendees={grouping.sections[1].attendees}
        salesFlowId="flow-volunteer"
      />,
    )

    expect(screen.getByText("Volunteer Cabin")).toBeTruthy()
    expect(screen.getByText("$222")).toBeTruthy()
    expect(screen.queryByText("Attendee Suite")).toBeNull()
    expect(screen.queryByText("$111")).toBeNull()
  })
})
