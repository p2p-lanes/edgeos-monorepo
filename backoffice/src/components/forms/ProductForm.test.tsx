/**
 * Tests for ProductForm — ticket-as-first-class-entity (Phase 8.2)
 *
 * Covers:
 * - does NOT render an Attendee Type / attendee_category input for ticket products
 * - renders a requires_check_in toggle switch
 * - requires_check_in defaults to true when category is ticket
 * - create payload includes requires_check_in field
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

import { PopupsService, ProductsService } from "@/client"
import { ProductForm } from "./ProductForm"

const mockGetPopup = vi.mocked(PopupsService.getPopup)
const mockListProductCategories = vi.mocked(
  ProductsService.listProductCategories,
)
const mockCreateProduct = vi.mocked(ProductsService.createProduct)

const POPUP_BASE = {
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

// RED tests — Phase 8.2: attendee_category removal + requires_check_in toggle
describe("ProductForm — ticket-as-first-class-entity (Phase 8.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockListProductCategories.mockResolvedValue([
      "ticket",
      "housing",
      "merch",
    ] as Awaited<ReturnType<typeof ProductsService.listProductCategories>>)

    mockGetPopup.mockResolvedValue(
      POPUP_BASE as Awaited<ReturnType<typeof PopupsService.getPopup>>,
    )
  })

  it("does NOT render an Attendee Type / attendee_category input for ticket products", async () => {
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // The form must not expose an "Attendee Type" select or label
    expect(screen.queryByText(/attendee type/i)).toBeNull()
    expect(screen.queryByText(/who can purchase this ticket/i)).toBeNull()
  })

  it("renders a requires_check_in toggle switch", async () => {
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // A switch/checkbox for requires_check_in should be present
    const toggle =
      document.querySelector('[id="requires_check_in"]') ??
      screen.queryByRole("switch", {
        name: /requires check.in|check.in|scanning/i,
      })
    expect(toggle).not.toBeNull()
  })

  it("requires_check_in defaults to true when category is ticket", async () => {
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // Default category is ticket — requires_check_in should default to checked
    const toggle = document.querySelector<HTMLButtonElement>(
      '[id="requires_check_in"]',
    )
    if (toggle) {
      // Switch component uses data-state=checked/unchecked
      expect(toggle.getAttribute("data-state")).toBe("checked")
    } else {
      // Fallback: find by aria-checked
      const checkbox = screen.queryByRole("switch")
      expect(checkbox?.getAttribute("aria-checked")).toBe("true")
    }
  })

  it("create payload includes requires_check_in field", async () => {
    const user = userEvent.setup()

    mockCreateProduct.mockResolvedValue({
      id: "product-new",
      name: "My Ticket",
      price: "50.00",
      category: "ticket",
      slug: "my-ticket",
      is_active: true,
      exclusive: false,
      popup_id: "popup-1",
      insurance_eligible: false,
    } as Awaited<ReturnType<typeof ProductsService.createProduct>>)

    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i))
    await user.type(screen.getByPlaceholderText(/product name/i), "My Ticket")

    const priceInput = screen.getByPlaceholderText("100.00")
    await user.type(priceInput, "50")

    await user.click(screen.getByRole("button", { name: /create product/i }))

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requires_check_in: expect.any(Boolean),
          }),
        }),
      )
    })
  })
})
