/**
 * Unit tests for VariantTicketSelect empty-attendee suppression.
 *
 * RED phase: these tests fail until attendeeHasRenderableContent filter is
 * applied before dispatching to layouts.
 *
 * Requirement: REQ: empty-attendee-card-suppression
 * - Virtual buyer attendee with products=[] and no purchased → LegacySectionLayout rendered (no attendee card)
 * - Attendee with at least one purchased product → card rendered
 * - Two attendees (one renderable, one not) → only renderable one shown
 */
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import VariantTicketSelect from "./variants/VariantTicketSelect"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAttendee(
  overrides: Partial<AttendeePassState> & { id: string; category: string },
): AttendeePassState {
  return {
    name: overrides.name ?? `Attendee ${overrides.id}`,
    products: overrides.products ?? [],
    ...overrides,
  } as AttendeePassState
}

function makeProduct(overrides: Partial<ProductsPass>): ProductsPass {
  const { id, category, ...rest } = overrides
  return {
    id: id ?? "prod-1",
    category: category ?? "ticket",
    name: "Ticket",
    price: 10,
    is_active: true,
    max_quantity: 1,
    description: null,
    compare_price: null,
    original_price: null,
    duration_type: "full",
    start_date: null,
    end_date: null,
    purchased: false,
    selected: false,
    edit: false,
    quantity: 0,
    original_quantity: 0,
    disabled: false,
    ...rest,
  } as unknown as ProductsPass
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAttendeePasses = vi.fn(() => [] as AttendeePassState[])

vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({
    attendeePasses: mockAttendeePasses(),
    toggleProduct: vi.fn(),
    isEditing: false,
  }),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    cart: { dynamicItems: {} },
    addDynamicItem: vi.fn(),
    removeDynamicItem: vi.fn(),
  }),
}))

vi.mock("@/helpers/tierPhaseState", () => ({
  resolveTierPhaseState: () => ({ blocked: false, badge: null }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => null,
  }),
}))

vi.mock("@/components/checkout-flow/shared/AddAttendeeButtons", () => ({
  default: () => null,
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VariantTicketSelect — empty-attendee suppression", () => {
  beforeEach(() => {
    mockAttendeePasses.mockReset()
    mockAttendeePasses.mockReturnValue([])
  })

  it("renders LegacySectionLayout (no attendee card) when attendeePasses is empty", () => {
    mockAttendeePasses.mockReturnValue([])

    render(
      <VariantTicketSelect
        products={[]}
        stepType="tickets"
        onSkip={vi.fn()}
        templateConfig={null}
      />,
    )

    // With no attendees, LegacySectionLayout renders. No attendee card header
    // meaning no "Main" text inside an attendee card.
    expect(screen.queryByText(/main/i)).toBeNull()
  })

  it("does not render an attendee card for virtual buyer with zero products and no purchased", () => {
    const virtualBuyer = makeAttendee({
      id: "buyer-1",
      category: "main",
      name: "Buyer",
      products: [], // no products → attendeeHasRenderableContent returns false
    })
    mockAttendeePasses.mockReturnValue([virtualBuyer])

    render(
      <VariantTicketSelect
        products={[]}
        stepType="tickets"
        onSkip={vi.fn()}
        templateConfig={{ sections: [] }}
      />,
    )

    // The attendee should NOT render a card.
    // "No passes available." should NOT appear inside a card for this attendee.
    expect(screen.queryByText(/no passes available/i)).toBeNull()
  })

  it("renders an attendee card when the attendee has at least one purchased product", () => {
    const purchasedProduct = makeProduct({
      id: "p1",
      category: "ticket",
      purchased: true,
    })
    const attendee = makeAttendee({
      id: "attendee-1",
      category: "main",
      name: "Main Attendee",
      products: [purchasedProduct],
    })
    mockAttendeePasses.mockReturnValue([attendee])

    // Sections config that references no product IDs → buildSectionGroups returns []
    // but purchased product makes attendeeHasRenderableContent return true
    render(
      <VariantTicketSelect
        products={[purchasedProduct]}
        stepType="tickets"
        onSkip={vi.fn()}
        templateConfig={{ sections: [{ key: "s1", label: "Section 1", order: 0, product_ids: [] }] }}
      />,
    )

    // The attendee card header should be rendered
    expect(screen.queryByText("Main Attendee")).not.toBeNull()
  })

  it("renders only the renderable attendee when one has products and the other does not", () => {
    const purchasedProduct = makeProduct({
      id: "p1",
      purchased: true,
    })
    const renderableAttendee = makeAttendee({
      id: "a1",
      category: "main",
      name: "Has Products",
      products: [purchasedProduct],
    })
    const emptyAttendee = makeAttendee({
      id: "a2",
      category: "spouse",
      name: "Empty Spouse",
      products: [],
    })
    mockAttendeePasses.mockReturnValue([renderableAttendee, emptyAttendee])

    render(
      <VariantTicketSelect
        products={[purchasedProduct]}
        stepType="tickets"
        onSkip={vi.fn()}
        templateConfig={null}
      />,
    )

    expect(screen.queryByText("Has Products")).not.toBeNull()
    expect(screen.queryByText("Empty Spouse")).toBeNull()
  })
})
