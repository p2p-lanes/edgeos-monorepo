/**
 * Tests for ProductForm — cross-field validation max_per_order vs total_stock_cap
 *
 * Covers:
 *   (a) max_per_order > total_stock_cap shows "Cannot exceed total stock cap (N)"
 *   (b) max_per_order <= total_stock_cap — no cross-field error shown
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
const mockListTierGroups = vi.mocked(TicketTierGroupsService.listTierGroups)

const POPUP_NO_TIER = {
  id: "popup-1",
  name: "Test Popup",
  slug: "test-popup",
  tier_progression_enabled: false,
  supported_languages: ["en"],
  default_language: "en",
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

describe("ProductForm — cross-field max_per_order vs total_stock_cap", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPopup.mockResolvedValue(
      POPUP_NO_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
    )
    mockListProductCategories.mockResolvedValue(["ticket", "merch"] as Awaited<
      ReturnType<typeof ProductsService.listProductCategories>
    >)
    mockListTierGroups.mockResolvedValue({
      results: [],
      paging: { offset: 0, limit: 100, total: 0 },
    } as Awaited<ReturnType<typeof TicketTierGroupsService.listTierGroups>>)
  })

  it("(a) shows cross-field error when max_per_order > total_stock_cap", async () => {
    const user = userEvent.setup()
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // Set total_stock_cap = 5
    const totalStockInput = screen.getByLabelText(/total stock/i)
    await user.clear(totalStockInput)
    await user.type(totalStockInput, "5")
    await user.tab()

    // Set max_per_order = 10 (exceeds cap)
    const maxPerOrderInput = screen.getByLabelText(/max per order/i)
    await user.clear(maxPerOrderInput)
    await user.type(maxPerOrderInput, "10")
    await user.tab() // trigger blur validator

    await waitFor(() => {
      expect(
        screen.getByText(/cannot exceed total stock cap \(5\)/i),
      ).toBeInTheDocument()
    })
  })

  it("(b) no cross-field error when max_per_order <= total_stock_cap", async () => {
    const user = userEvent.setup()
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // Set total_stock_cap = 10
    const totalStockInput = screen.getByLabelText(/total stock/i)
    await user.clear(totalStockInput)
    await user.type(totalStockInput, "10")
    await user.tab()

    // Set max_per_order = 3 (within cap)
    const maxPerOrderInput = screen.getByLabelText(/max per order/i)
    await user.clear(maxPerOrderInput)
    await user.type(maxPerOrderInput, "3")
    await user.tab()

    await waitFor(() => {
      expect(
        screen.queryByText(/cannot exceed total stock cap/i),
      ).not.toBeInTheDocument()
    })
  })
})
