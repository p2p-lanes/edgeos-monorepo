/**
 * Tests for PassSelectionSection tier-group rendering (Phase 5, task 5.1).
 *
 * Covers:
 * - One group card rendered per tier_group.id (not one per product)
 * - available phase (sales_state="available" + is_purchasable=true) → CTA enabled
 * - upcoming phase (sales_state="upcoming") → visible, no CTA, date shown
 * - sold_out phase (sales_state="sold_out") → visible, disabled styling
 * - expired phase (sales_state="expired") → visible, disabled styling
 * - Ungrouped products (no tier_group) → flat legacy rendering (BC-1)
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { TierGroupPublic, TierPhasePublic } from "@/client"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import PassSelectionSection from "./PassSelectionSection"

// Mock localStorage for jsdom environment (dates helper reads portal_language)
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
})

// ---------------------------------------------------------------------------
// framer-motion mock — strip animation props to avoid React DOM warnings
// ---------------------------------------------------------------------------
const MOTION_PROPS = new Set([
  "animate",
  "initial",
  "exit",
  "transition",
  "whileHover",
  "whileTap",
  "layout",
  "variants",
  "custom",
])
function stripMotionProps<T extends Record<string, unknown>>(props: T) {
  return Object.fromEntries(
    Object.entries(props).filter(([k]) => !MOTION_PROPS.has(k)),
  )
}
vi.mock("framer-motion", () => ({
  motion: {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    div: ({ children, className, ...rest }: any) => (
      <div className={className} {...stripMotionProps(rest)}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

// ---------------------------------------------------------------------------
// Provider / hook mocks
// ---------------------------------------------------------------------------
const mockToggleProduct = vi.fn()

vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => mockPassesProvider(),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({ editCredit: 0 }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "city-1", name: "Test City" }),
  }),
}))

vi.mock("@/checkout/popupCheckoutPolicy", () => ({
  CHECKOUT_MODE: { PASS_SYSTEM: "pass_system", SIMPLE_QUANTITY: "simple_quantity" },
  resolvePopupCheckoutPolicy: () => ({ checkoutMode: "pass_system" }),
}))

vi.mock("@/checkout/passSelectionUi", () => ({
  getPassSelectionLayout: () => "grouped",
  shouldDisableForPrimaryRestriction: () => false,
}))

vi.mock("@/components/checkout-flow/shared/AddAttendeeButtons", () => ({
  default: () => <div data-testid="add-attendee-buttons" />,
}))

vi.mock("@/components/ui/QuantitySelector", () => ({
  resolveMaxQuantity: () => 10,
  supportsQuantitySelector: () => false,
}))

// ---------------------------------------------------------------------------
// Helpers — mock passesProvider return value
// ---------------------------------------------------------------------------
let mockPassesProvider: () => {
  attendeePasses: AttendeePassState[]
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
}

function setMockAttendees(attendeePasses: AttendeePassState[]) {
  mockPassesProvider = () => ({
    attendeePasses,
    toggleProduct: mockToggleProduct,
    isEditing: false,
  })
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------
const TIER_GROUP_X: TierGroupPublic = {
  id: "group-x",
  tenant_id: "tenant-1",
  name: "Full Pass",
  shared_stock_cap: 200,
  shared_stock_remaining: 100,
}

function makeTierPhase(
  overrides: Partial<TierPhasePublic> & {
    sales_state: TierPhasePublic["sales_state"]
    is_purchasable: boolean
  },
): TierPhasePublic {
  return {
    id: overrides.id ?? "phase-1",
    group_id: "group-x",
    product_id: overrides.product_id ?? "prod-1",
    order: overrides.order ?? 1,
    label: overrides.label ?? "Early Bird",
    sale_starts_at: overrides.sale_starts_at ?? "2026-01-01T00:00:00Z",
    sale_ends_at: overrides.sale_ends_at ?? "2026-03-01T00:00:00Z",
    sales_state: overrides.sales_state,
    is_purchasable: overrides.is_purchasable,
    remaining: overrides.remaining ?? 50,
  }
}

function makeProduct(
  overrides: Partial<ProductsPass> & { id: string; name: string },
): ProductsPass {
  return {
    id: overrides.id,
    name: overrides.name,
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    slug: overrides.id,
    price: overrides.price ?? 500,
    compare_price: null,
    category: "ticket",
    attendee_category: "main",
    duration_type: "full",
    is_active: true,
    selected: false,
    purchased: false,
    disabled: false,
    quantity: 1,
    original_quantity: 1,
    tier_group: overrides.tier_group ?? null,
    phase: overrides.phase ?? null,
    ...overrides,
  }
}

function makeAttendee(
  id: string,
  products: ProductsPass[],
): AttendeePassState {
  return {
    id,
    name: "Test Attendee",
    category: "main",
    email: "test@example.com",
    gender: null,
    popup_id: "popup-1",
    tenant_id: "tenant-1",
    products,
  } as AttendeePassState
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PassSelectionSection — tier group rendering", () => {
  it("5.1-a: renders one group card for two products sharing the same tier_group.id", () => {
    const earlyBirdPhase = makeTierPhase({
      id: "phase-eb",
      product_id: "prod-eb",
      order: 1,
      label: "Early Bird",
      sales_state: "expired",
      is_purchasable: false,
    })
    const regularPhase = makeTierPhase({
      id: "phase-reg",
      product_id: "prod-reg",
      order: 2,
      label: "Regular",
      sales_state: "available",
      is_purchasable: true,
    })

    const earlyBird = makeProduct({
      id: "prod-eb",
      name: "Early Bird Pass",
      tier_group: TIER_GROUP_X,
      phase: earlyBirdPhase,
    })
    const regular = makeProduct({
      id: "prod-reg",
      name: "Regular Pass",
      tier_group: TIER_GROUP_X,
      phase: regularPhase,
    })

    setMockAttendees([makeAttendee("attendee-1", [earlyBird, regular])])
    render(<PassSelectionSection />)

    // One group card header, not two
    const groupHeaders = screen.queryAllByTestId("tier-group-card")
    expect(groupHeaders).toHaveLength(1)
  })

  it("5.1-b: available phase (sales_state=available + is_purchasable=true) renders an enabled CTA button", () => {
    const phase = makeTierPhase({
      id: "phase-avail",
      product_id: "prod-avail",
      order: 1,
      label: "Available Phase",
      sales_state: "available",
      is_purchasable: true,
    })
    const product = makeProduct({
      id: "prod-avail",
      name: "Available Pass",
      tier_group: TIER_GROUP_X,
      phase,
    })

    setMockAttendees([makeAttendee("attendee-1", [product])])
    render(<PassSelectionSection />)

    const btn = screen.queryByTestId("tier-phase-cta-prod-avail")
    expect(btn).not.toBeNull()
    // CTA should be an enabled button (no disabled attribute)
    expect(btn?.hasAttribute("disabled")).toBe(false)
  })

  it("5.1-c: upcoming phase (sales_state=upcoming) is visible but renders no CTA button", () => {
    const phase = makeTierPhase({
      id: "phase-up",
      product_id: "prod-up",
      order: 2,
      label: "Regular Upcoming",
      sale_starts_at: "2026-07-01T00:00:00Z",
      sales_state: "upcoming",
      is_purchasable: false,
    })
    const product = makeProduct({
      id: "prod-up",
      name: "Upcoming Pass",
      tier_group: TIER_GROUP_X,
      phase,
    })

    setMockAttendees([makeAttendee("attendee-1", [product])])
    render(<PassSelectionSection />)

    // Phase row must be visible
    expect(screen.queryByTestId("tier-phase-row-prod-up")).not.toBeNull()
    // No CTA button
    expect(screen.queryByTestId("tier-phase-cta-prod-up")).toBeNull()
    // Date label visible
    expect(screen.queryByTestId("tier-phase-date-prod-up")).not.toBeNull()
  })

  it("5.1-d: sold_out phase (sales_state=sold_out) is visible with disabled/greyed styling", () => {
    const phase = makeTierPhase({
      id: "phase-sold",
      product_id: "prod-sold",
      order: 1,
      label: "Sold Out Phase",
      sales_state: "sold_out",
      is_purchasable: false,
      remaining: 0,
    })
    const product = makeProduct({
      id: "prod-sold",
      name: "Sold Out Pass",
      tier_group: TIER_GROUP_X,
      phase,
    })

    setMockAttendees([makeAttendee("attendee-1", [product])])
    render(<PassSelectionSection />)

    const row = screen.queryByTestId("tier-phase-row-prod-sold")
    expect(row).not.toBeNull()
    // Must have a data-state attribute or class that signals disabled/sold-out
    expect(row?.getAttribute("data-phase-state")).toBe("sold_out")
  })

  it("5.1-e: expired phase (sales_state=expired) is visible with disabled/greyed styling", () => {
    const phase = makeTierPhase({
      id: "phase-exp",
      product_id: "prod-exp",
      order: 1,
      label: "Expired Phase",
      sales_state: "expired",
      is_purchasable: false,
    })
    const product = makeProduct({
      id: "prod-exp",
      name: "Expired Pass",
      tier_group: TIER_GROUP_X,
      phase,
    })

    setMockAttendees([makeAttendee("attendee-1", [product])])
    render(<PassSelectionSection />)

    const row = screen.queryByTestId("tier-phase-row-prod-exp")
    expect(row).not.toBeNull()
    expect(row?.getAttribute("data-phase-state")).toBe("expired")
  })

  it("5.1-f: phases within a group are sorted by phase.order ascending", () => {
    const phase1 = makeTierPhase({
      id: "phase-a",
      product_id: "prod-a",
      order: 2,
      label: "Regular",
      sales_state: "available",
      is_purchasable: true,
    })
    const phase2 = makeTierPhase({
      id: "phase-b",
      product_id: "prod-b",
      order: 1,
      label: "Early Bird",
      sales_state: "expired",
      is_purchasable: false,
    })

    const productA = makeProduct({ id: "prod-a", name: "Regular Pass", tier_group: TIER_GROUP_X, phase: phase1 })
    const productB = makeProduct({ id: "prod-b", name: "Early Bird Pass", tier_group: TIER_GROUP_X, phase: phase2 })

    setMockAttendees([makeAttendee("attendee-1", [productA, productB])])
    render(<PassSelectionSection />)

    const rows = screen.queryAllByTestId(/^tier-phase-row-/)
    expect(rows).toHaveLength(2)
    // First row should be Early Bird (order=1), second Regular (order=2)
    expect(rows[0]?.getAttribute("data-phase-order")).toBe("1")
    expect(rows[1]?.getAttribute("data-phase-order")).toBe("2")
  })
})

describe("PassSelectionSection — backward compatibility (BC-1)", () => {
  it("5.1-g: ungrouped products (no tier_group) render as plain pass cards, not group cards", () => {
    const ungroupedProduct = makeProduct({
      id: "prod-plain",
      name: "Plain Pass",
      tier_group: null,
      phase: null,
    })

    setMockAttendees([makeAttendee("attendee-1", [ungroupedProduct])])
    render(<PassSelectionSection />)

    // No group cards
    expect(screen.queryAllByTestId("tier-group-card")).toHaveLength(0)
    // Plain pass option must be present
    expect(screen.queryByText("Plain Pass")).not.toBeNull()
  })

  it("5.1-h: mixed scenario — grouped and ungrouped products in same attendee renders both correctly", () => {
    const phase = makeTierPhase({
      id: "phase-mix",
      product_id: "prod-grouped",
      order: 1,
      label: "Early Bird",
      sales_state: "available",
      is_purchasable: true,
    })
    const grouped = makeProduct({
      id: "prod-grouped",
      name: "Grouped Pass",
      tier_group: TIER_GROUP_X,
      phase,
    })
    const ungrouped = makeProduct({
      id: "prod-ungrouped",
      name: "Ungrouped Pass",
      tier_group: null,
      phase: null,
    })

    setMockAttendees([makeAttendee("attendee-1", [grouped, ungrouped])])
    render(<PassSelectionSection />)

    // One group card
    expect(screen.queryAllByTestId("tier-group-card")).toHaveLength(1)
    // Ungrouped pass still rendered
    expect(screen.queryByText("Ungrouped Pass")).not.toBeNull()
  })
})
