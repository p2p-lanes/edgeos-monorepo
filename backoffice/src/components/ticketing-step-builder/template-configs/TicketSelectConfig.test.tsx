/**
 * Tests for TicketSelectConfig — tier group grouped display (Task 4.5)
 *
 * Covers:
 * - Given two products that belong to the same tier group and one ungrouped product,
 *   the picker renders one header per group with the group name and each phase
 *   labelled + ordered ascending by phase.order.
 * - An "Ungrouped" bucket for products without a tier_group.
 * - Existing section selection behavior is preserved.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  ProductsService: {
    listProducts: vi.fn(),
  },
}))

import { ProductsService } from "@/client"
import { TicketSelectConfig } from "./TicketSelectConfig"

const mockListProducts = vi.mocked(ProductsService.listProducts)

// Two products in the same tier group (group-a), one ungrouped
const GROUP_A = {
  id: "group-a",
  tenant_id: "tenant-1",
  name: "Early Bird Package",
  shared_stock_cap: 100,
  shared_stock_remaining: 60,
  phases: [],
}

const PHASE_EARLY = {
  id: "phase-1",
  group_id: "group-a",
  product_id: "product-1",
  order: 1,
  label: "Early Bird",
  sale_starts_at: "2026-01-01T00:00:00Z",
  sale_ends_at: "2026-02-28T23:59:59Z",
  sales_state: "expired" as const,
  is_purchasable: false,
  remaining: null,
}

const PHASE_REGULAR = {
  id: "phase-2",
  group_id: "group-a",
  product_id: "product-2",
  order: 2,
  label: "Regular",
  sale_starts_at: "2026-03-01T00:00:00Z",
  sale_ends_at: "2026-04-30T23:59:59Z",
  sales_state: "available" as const,
  is_purchasable: true,
  remaining: null,
}

const PRODUCT_GROUPED_1 = {
  id: "product-1",
  name: "Early Bird Ticket",
  slug: "early-bird-ticket",
  price: "100.00",
  popup_id: "popup-1",
  tenant_id: "tenant-1",
  is_active: true,
  exclusive: false,
  insurance_eligible: false,
  tier_group: GROUP_A,
  phase: PHASE_EARLY,
}

// Note: ordered AFTER product-1 but listed second — tests that we sort by phase.order
const PRODUCT_GROUPED_2 = {
  id: "product-2",
  name: "Regular Ticket",
  slug: "regular-ticket",
  price: "150.00",
  popup_id: "popup-1",
  tenant_id: "tenant-1",
  is_active: true,
  exclusive: false,
  insurance_eligible: false,
  tier_group: GROUP_A,
  phase: PHASE_REGULAR,
}

const PRODUCT_UNGROUPED = {
  id: "product-3",
  name: "VIP Access",
  slug: "vip-access",
  price: "500.00",
  popup_id: "popup-1",
  tenant_id: "tenant-1",
  is_active: true,
  exclusive: false,
  insurance_eligible: false,
  tier_group: null,
  phase: null,
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const DEFAULT_CONFIG = {
  sections: [],
  variant: "stacked",
}

describe("TicketSelectConfig — tier group grouped display", () => {
  it("renders one group header for products sharing a tier group", async () => {
    mockListProducts.mockResolvedValue({
      results: [PRODUCT_GROUPED_1, PRODUCT_GROUPED_2, PRODUCT_UNGROUPED],
      paging: { limit: 200, offset: 0, total: 3 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    render(
      <TicketSelectConfig
        config={DEFAULT_CONFIG}
        onChange={vi.fn()}
        popupId="popup-1"
        productCategory="ticket"
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      // Group header for "Early Bird Package"
      expect(screen.getByText("Early Bird Package")).toBeInTheDocument()
    })

    // Should not render two separate headers for the same group
    expect(screen.getAllByText("Early Bird Package")).toHaveLength(1)
  })

  it("renders phase labels ordered ascending by phase.order within the group", async () => {
    mockListProducts.mockResolvedValue({
      results: [PRODUCT_GROUPED_2, PRODUCT_GROUPED_1], // reversed order in response
      paging: { limit: 200, offset: 0, total: 2 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    render(
      <TicketSelectConfig
        config={DEFAULT_CONFIG}
        onChange={vi.fn()}
        popupId="popup-1"
        productCategory="ticket"
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText("Early Bird")).toBeInTheDocument()
      expect(screen.getByText("Regular")).toBeInTheDocument()
    })

    // Early Bird (order=1) should appear before Regular (order=2) in the DOM
    const earlyBird = screen.getByText("Early Bird")
    const regular = screen.getByText("Regular")
    expect(
      earlyBird.compareDocumentPosition(regular) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("renders an 'Ungrouped' section for products without a tier group", async () => {
    mockListProducts.mockResolvedValue({
      results: [PRODUCT_GROUPED_1, PRODUCT_UNGROUPED],
      paging: { limit: 200, offset: 0, total: 2 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    render(
      <TicketSelectConfig
        config={DEFAULT_CONFIG}
        onChange={vi.fn()}
        popupId="popup-1"
        productCategory="ticket"
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText(/ungrouped/i)).toBeInTheDocument()
      // VIP Access should appear in the ungrouped section
      expect(screen.getByText("VIP Access")).toBeInTheDocument()
    })
  })

  it("does NOT render the 'Ungrouped' section when all products have tier groups", async () => {
    mockListProducts.mockResolvedValue({
      results: [PRODUCT_GROUPED_1, PRODUCT_GROUPED_2],
      paging: { limit: 200, offset: 0, total: 2 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    render(
      <TicketSelectConfig
        config={DEFAULT_CONFIG}
        onChange={vi.fn()}
        popupId="popup-1"
        productCategory="ticket"
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText("Early Bird Package")).toBeInTheDocument()
    })

    expect(screen.queryByText(/ungrouped/i)).not.toBeInTheDocument()
  })

  it("renders flat list (no Tier Groups panel) when no products have tier groups", async () => {
    const ungrouped1 = { ...PRODUCT_UNGROUPED, id: "p1", name: "Basic Ticket" }
    const ungrouped2 = {
      ...PRODUCT_UNGROUPED,
      id: "p2",
      name: "Premium Ticket",
    }

    mockListProducts.mockResolvedValue({
      results: [ungrouped1, ungrouped2],
      paging: { limit: 200, offset: 0, total: 2 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    render(
      <TicketSelectConfig
        config={DEFAULT_CONFIG}
        onChange={vi.fn()}
        popupId="popup-1"
        productCategory="ticket"
      />,
      { wrapper: makeWrapper() },
    )

    // Wait for component to load (Design Variant section is always present)
    await waitFor(() => {
      expect(screen.getByText("Design Variant")).toBeInTheDocument()
    })

    // No "Tier Groups" header when no products have tier groups (legacy flat mode)
    expect(screen.queryByText("Tier Groups")).not.toBeInTheDocument()
    // No "Ungrouped" header in legacy mode
    expect(screen.queryByText(/ungrouped/i)).not.toBeInTheDocument()
  })
})
