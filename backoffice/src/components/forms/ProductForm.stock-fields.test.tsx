/**
 * Tests for ProductForm — two-field stock layout (product-inventory-redesign, Slice 4 / Task 6.5)
 *
 * TDD phase: RED — written BEFORE the implementation change.
 *
 * Covers:
 *   (a) "Total stock" input renders instead of "Max Quantity"
 *   (b) "Max per order" input renders
 *   (c) Submitting valid values sends total_stock_cap and max_per_order (not max_quantity)
 *   (d) Validation rejects 0 for total_stock_cap
 *   (e) Validation rejects 0 for max_per_order
 *   (f) Both fields left empty → null (unlimited)
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
  default: () => ({ isAdmin: true, isOperatorOrAbove: true }),
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

import { PopupsService, ProductsService } from "@/client"
import { ProductForm } from "./ProductForm"

const mockGetPopup = vi.mocked(PopupsService.getPopup)
const mockListProductCategories = vi.mocked(
  ProductsService.listProductCategories,
)
const mockCreateProduct = vi.mocked(ProductsService.createProduct)

const POPUP_NO_TIER = {
  id: "popup-1",
  name: "Test Popup",
  slug: "test-popup",
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

describe("ProductForm — two-field stock layout (6.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetPopup.mockResolvedValue(
      POPUP_NO_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
    )

    mockListProductCategories.mockResolvedValue([
      "ticket",
      "housing",
      "merch",
    ] as Awaited<ReturnType<typeof ProductsService.listProductCategories>>)

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
  })

  describe("(a) field presence", () => {
    it("renders 'Total stock' input — NOT 'Max Quantity'", async () => {
      render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

      await waitFor(() => screen.getByPlaceholderText(/product name/i), {
        timeout: 3000,
      })

      // New field should exist
      expect(screen.getByLabelText(/total stock/i)).toBeInTheDocument()
      // Old field should be gone
      expect(screen.queryByLabelText(/max quantity/i)).not.toBeInTheDocument()
    })

    it("renders 'Max per order' input", async () => {
      render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

      await waitFor(() => screen.getByPlaceholderText(/product name/i), {
        timeout: 3000,
      })

      expect(screen.getByLabelText(/max per order/i)).toBeInTheDocument()
    })
  })

  describe("(b) submit with valid stock values", () => {
    it("sends total_stock_cap and max_per_order in create payload", async () => {
      const user = userEvent.setup()
      render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

      await waitFor(() => screen.getByPlaceholderText(/product name/i))
      await user.type(screen.getByPlaceholderText(/product name/i), "My Ticket")
      await user.type(screen.getByPlaceholderText("100.00"), "50")

      const totalStockInput = screen.getByLabelText(/total stock/i)
      await user.clear(totalStockInput)
      await user.type(totalStockInput, "100")

      const maxPerOrderInput = screen.getByLabelText(/max per order/i)
      await user.clear(maxPerOrderInput)
      await user.type(maxPerOrderInput, "3")

      await user.click(screen.getByRole("button", { name: /create product/i }))

      await waitFor(() => {
        expect(mockCreateProduct).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              total_stock_cap: 100,
              max_per_order: 3,
            }),
          }),
        )
      })

      // Must NOT send max_quantity
      const callArgs = mockCreateProduct.mock.calls[0]?.[0] as {
        requestBody: Record<string, unknown>
      }
      expect(callArgs?.requestBody).not.toHaveProperty("max_quantity")
    })
  })

  describe("(c) both fields empty → unlimited", () => {
    it("sends null for total_stock_cap and max_per_order when both left empty", async () => {
      const user = userEvent.setup()
      render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

      await waitFor(() => screen.getByPlaceholderText(/product name/i))
      await user.type(screen.getByPlaceholderText(/product name/i), "My Ticket")
      await user.type(screen.getByPlaceholderText("100.00"), "50")

      // Leave both stock fields empty

      await user.click(screen.getByRole("button", { name: /create product/i }))

      await waitFor(() => {
        expect(mockCreateProduct).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.not.objectContaining({
              total_stock_cap: expect.any(Number),
              max_per_order: expect.any(Number),
            }),
          }),
        )
      })
    })
  })

  describe("(d) validation rejects invalid values", () => {
    it("shows error when total_stock_cap is 0", async () => {
      const user = userEvent.setup()
      render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

      await waitFor(() => screen.getByPlaceholderText(/product name/i))

      const totalStockInput = screen.getByLabelText(/total stock/i)
      await user.type(totalStockInput, "0")
      await user.tab() // trigger blur

      await waitFor(() => {
        expect(
          screen.getByText(/total stock must be.*positive/i),
        ).toBeInTheDocument()
      })
    })

    it("shows error when max_per_order is 0", async () => {
      const user = userEvent.setup()
      render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

      await waitFor(() => screen.getByPlaceholderText(/product name/i))

      const maxPerOrderInput = screen.getByLabelText(/max per order/i)
      await user.type(maxPerOrderInput, "0")
      await user.tab()

      await waitFor(() => {
        expect(
          screen.getByText(/max per order must be.*positive/i),
        ).toBeInTheDocument()
      })
    })
  })
})
