/**
 * Tests for ProductForm — tier group integration (Tasks 4.3)
 *
 * Covers:
 * (a) When popup has tier_progression_enabled=true AND category === "ticket",
 *     the form shows a "Tier group" section with TierGroupPicker + phase fields.
 * (b) Selecting a group enables the phase sub-form.
 * (c) BA-3: saving with overlapping sale windows on the same group shows
 *     an inline validation error and does NOT call the API.
 * (d) Clean save with non-overlapping window calls createTierPhase with
 *     the correct payload.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  ProductsService: {
    listProductCategories: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    listProducts: vi.fn(),
  },
  PopupsService: {
    getPopup: vi.fn(),
  },
  TicketTierGroupsService: {
    listTierGroups: vi.fn(),
    getTierGroup: vi.fn(),
    createTierGroup: vi.fn(),
    createTierPhase: vi.fn(),
    updateTierPhase: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    selectedPopupId: "popup-1",
    isContextReady: true,
  }),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ isAdmin: true }),
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

vi.mock("@/hooks/useUnsavedChanges", () => ({
  useUnsavedChanges: () => ({ state: "unblocked" }),
  UnsavedChangesDialog: () => null,
}))

import {
  PopupsService,
  ProductsService,
  TicketTierGroupsService,
} from "@/client"
import { ProductForm } from "./ProductForm"

const mockGetPopup = vi.mocked(PopupsService.getPopup)
const mockListProductCategories = vi.mocked(
  ProductsService.listProductCategories,
)
const mockCreateProduct = vi.mocked(ProductsService.createProduct)
const mockListTierGroups = vi.mocked(TicketTierGroupsService.listTierGroups)
const mockGetTierGroup = vi.mocked(TicketTierGroupsService.getTierGroup)
const mockCreateTierPhase = vi.mocked(TicketTierGroupsService.createTierPhase)

const POPUP_WITH_TIER = {
  id: "popup-1",
  name: "Test Popup",
  slug: "test-popup",
  tier_progression_enabled: true,
  supported_languages: ["en"],
  default_language: "en",
}

const POPUP_WITHOUT_TIER = {
  ...POPUP_WITH_TIER,
  tier_progression_enabled: false,
}

const GROUP_A = {
  id: "group-a",
  tenant_id: "tenant-1",
  name: "Early Bird",
  shared_stock_cap: 100,
  shared_stock_remaining: 80,
  phases: [
    {
      id: "phase-1",
      group_id: "group-a",
      product_id: "other-product",
      order: 1,
      label: "Early Bird",
      sale_starts_at: "2026-01-01T00:00:00Z",
      sale_ends_at: "2026-02-28T23:59:59Z",
      sales_state: "expired" as const,
      is_purchasable: false,
      remaining: null,
    },
  ],
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

describe("ProductForm — tier group integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockListProductCategories.mockResolvedValue([
      "ticket",
      "housing",
      "merch",
    ] as Awaited<ReturnType<typeof ProductsService.listProductCategories>>)

    mockListTierGroups.mockResolvedValue({
      results: [GROUP_A],
    } as Awaited<ReturnType<typeof TicketTierGroupsService.listTierGroups>>)

    mockGetTierGroup.mockResolvedValue(
      GROUP_A as Awaited<ReturnType<typeof TicketTierGroupsService.getTierGroup>>,
    )

    mockCreateProduct.mockResolvedValue({
      id: "product-new",
      name: "Test Ticket",
      price: "100.00",
      category: "ticket",
      slug: "test-ticket",
      is_active: true,
      exclusive: false,
      popup_id: "popup-1",
      insurance_eligible: false,
    } as Awaited<ReturnType<typeof ProductsService.createProduct>>)

    mockCreateTierPhase.mockResolvedValue({
      id: "phase-new",
      group_id: "group-a",
      product_id: "product-new",
      order: 2,
      label: "Regular",
      sale_starts_at: "2026-03-01T00:00:00Z",
      sale_ends_at: "2026-04-30T23:59:59Z",
      sales_state: "available" as const,
      is_purchasable: true,
      remaining: null,
    } as Awaited<ReturnType<typeof TicketTierGroupsService.createTierPhase>>)
  })

  describe("(a) tier section visibility", () => {
    it("shows Tier group section when popup has tier_progression_enabled=true and category=ticket", async () => {
      mockGetPopup.mockResolvedValue(
        POPUP_WITH_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
      )

      render(<ProductForm onSuccess={vi.fn()} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => {
        // The section title is an h3 with text "Tier Group"
        const heading = screen.getAllByText(/tier group/i)
        expect(heading.length).toBeGreaterThan(0)
        // The TierGroupPicker should also be visible (Early Bird group)
        expect(screen.getByText("Early Bird")).toBeInTheDocument()
      })
    })

    it("does NOT show Tier group section when tier_progression_enabled=false", async () => {
      mockGetPopup.mockResolvedValue(
        POPUP_WITHOUT_TIER as Awaited<
          ReturnType<typeof PopupsService.getPopup>
        >,
      )

      render(<ProductForm onSuccess={vi.fn()} />, {
        wrapper: makeWrapper(),
      })

      // Wait for form to render (the name input is always present)
      await waitFor(
        () => screen.getByPlaceholderText(/product name/i),
        { timeout: 3000 },
      )

      // listTierGroups should not have been called (no TierGroupPicker mounted)
      expect(mockListTierGroups).not.toHaveBeenCalled()
      // No Early Bird group rendered
      expect(screen.queryByText("Early Bird")).not.toBeInTheDocument()
    })

    it("does NOT show Tier group section for non-ticket categories even when flag is on", async () => {
      mockGetPopup.mockResolvedValue(
        POPUP_WITH_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
      )

      render(<ProductForm onSuccess={vi.fn()} />, {
        wrapper: makeWrapper(),
      })

      // Wait for the tier section to appear first (tier_progression_enabled=true + ticket)
      await waitFor(() => screen.getByText("Early Bird"), { timeout: 3000 })

      // Radix Select renders a hidden native <select> for accessibility.
      // Use that to change the category in jsdom.
      const nativeSelects = document.querySelectorAll<HTMLSelectElement>("select")
      const categorySelect = Array.from(nativeSelects).find((s) =>
        Array.from(s.options).some((o) => o.value === "ticket"),
      )
      expect(categorySelect).toBeDefined()
      // biome-ignore lint: test-only direct DOM manipulation
      categorySelect!.value = "housing"
      categorySelect!.dispatchEvent(new Event("change", { bubbles: true }))

      // TierGroupPicker should not be rendered after category change
      await waitFor(() => {
        expect(screen.queryByText("Early Bird")).not.toBeInTheDocument()
      })
    })
  })

  describe("(b) selecting a group enables phase sub-form", () => {
    it("shows phase fields after a group is selected", async () => {
      mockGetPopup.mockResolvedValue(
        POPUP_WITH_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
      )

      render(<ProductForm onSuccess={vi.fn()} />, {
        wrapper: makeWrapper(),
      })

      // Wait for tier group picker to load groups
      await waitFor(() => screen.getByText("Early Bird"))

      // Click the group
      await userEvent.click(screen.getByRole("button", { name: /early bird/i }))

      // Phase fields should appear (order is derived server-side,
      // so only label + sale window inputs are surfaced)
      await waitFor(() => {
        expect(
          screen.getByLabelText(/phase label/i),
        ).toBeInTheDocument()
        expect(
          screen.getByLabelText(/sale starts/i),
        ).toBeInTheDocument()
        expect(
          screen.getByLabelText(/sale ends/i),
        ).toBeInTheDocument()
      })
      // `order` should no longer be an input.
      expect(
        screen.queryByLabelText(/phase order/i),
      ).not.toBeInTheDocument()
    })

    it("hides phase fields when no group is selected", async () => {
      mockGetPopup.mockResolvedValue(
        POPUP_WITH_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
      )

      render(<ProductForm onSuccess={vi.fn()} />, {
        wrapper: makeWrapper(),
      })

      // Wait for TierGroupPicker to appear but without selecting a group
      await waitFor(() => screen.getByText("Early Bird"), { timeout: 3000 })

      expect(screen.queryByLabelText(/phase label/i)).not.toBeInTheDocument()
    })
  })

  describe("(c) BA-3 overlap validation", () => {
    it("shows inline error and does NOT call API when sale window overlaps existing phase", async () => {
      const user = userEvent.setup()
      mockGetPopup.mockResolvedValue(
        POPUP_WITH_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
      )

      render(<ProductForm onSuccess={vi.fn()} />, {
        wrapper: makeWrapper(),
      })

      // Fill product name
      await waitFor(() => screen.getByPlaceholderText(/product name/i))
      await user.type(screen.getByPlaceholderText(/product name/i), "Test Ticket")

      // Fill price
      const priceInput = screen.getByPlaceholderText("100.00")
      await user.type(priceInput, "150")

      // Wait for tier picker and select group
      await waitFor(() => screen.getByText("Early Bird"))
      await user.click(screen.getByRole("button", { name: /early bird/i }))

      // Fill phase fields with overlapping window (GROUP_A has phase 2026-01-01 to 2026-02-28)
      await waitFor(() => screen.getByLabelText(/phase label/i))
      await user.clear(screen.getByLabelText(/phase label/i))
      await user.type(screen.getByLabelText(/phase label/i), "Overlapping")

      await user.clear(screen.getByLabelText(/sale starts/i))
      await user.type(screen.getByLabelText(/sale starts/i), "2026-01-15")

      await user.clear(screen.getByLabelText(/sale ends/i))
      await user.type(screen.getByLabelText(/sale ends/i), "2026-02-15")

      // Submit
      await user.click(screen.getByRole("button", { name: /create product/i }))

      await waitFor(() => {
        expect(screen.getByText(/overlaps/i)).toBeInTheDocument()
      })

      expect(mockCreateProduct).not.toHaveBeenCalled()
      expect(mockCreateTierPhase).not.toHaveBeenCalled()
    })
  })

  describe("(d) clean save with non-overlapping window", () => {
    it("calls createTierPhase with correct payload after product is created", async () => {
      const user = userEvent.setup()
      mockGetPopup.mockResolvedValue(
        POPUP_WITH_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
      )

      render(<ProductForm onSuccess={vi.fn()} />, {
        wrapper: makeWrapper(),
      })

      // Fill product name
      await waitFor(() => screen.getByPlaceholderText(/product name/i))
      await user.type(screen.getByPlaceholderText(/product name/i), "Test Ticket")

      // Fill price
      await user.type(screen.getByPlaceholderText("100.00"), "150")

      // Select group
      await waitFor(() => screen.getByText("Early Bird"))
      await user.click(screen.getByRole("button", { name: /early bird/i }))

      // Fill phase fields with NON-overlapping window (after 2026-02-28)
      await waitFor(() => screen.getByLabelText(/phase label/i))

      const labelInput = screen.getByLabelText(/phase label/i)
      await user.clear(labelInput)
      await user.type(labelInput, "Regular")

      const saleStartInput = screen.getByLabelText(/sale starts/i)
      await user.clear(saleStartInput)
      await user.type(saleStartInput, "2026-03-01")

      const saleEndInput = screen.getByLabelText(/sale ends/i)
      await user.clear(saleEndInput)
      await user.type(saleEndInput, "2026-04-30")

      // Submit
      await user.click(screen.getByRole("button", { name: /create product/i }))

      await waitFor(() => {
        expect(mockCreateProduct).toHaveBeenCalled()
        expect(mockCreateTierPhase).toHaveBeenCalledWith(
          expect.objectContaining({
            groupId: "group-a",
            requestBody: expect.objectContaining({
              product_id: "product-new",
              label: "Regular",
            }),
          }),
        )
      })
    })
  })
})
