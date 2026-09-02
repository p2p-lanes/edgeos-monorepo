/**
 * Tests for ProductForm — patron-product-rules (Phase 3.1)
 *
 * Covers:
 * - price Input NOT rendered when category=patreon
 * - submit payload has price=0 when category=patreon
 * - patreon category option disabled when popup already has active patreon product
 * - price Input rendered and required when category=ticket
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
const mockListProducts = vi.mocked(ProductsService.listProducts)
const mockCreateProduct = vi.mocked(ProductsService.createProduct)

const POPUP_BASE = {
  id: "popup-1",
  name: "Test Popup",
  slug: "test-popup",
  supported_languages: ["en"],
  default_language: "en",
}

const PRODUCT_PATREON_BASE = {
  id: "product-patron-1",
  name: "Patron",
  price: "0",
  category: "patreon",
  slug: "patron",
  is_active: true,
  exclusive: false,
  popup_id: "popup-1",
  insurance_eligible: false,
  deleted_at: null,
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

describe("ProductForm — patron-product-rules (Phase 3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockListProductCategories.mockResolvedValue([
      "ticket",
      "housing",
      "merch",
      "patreon",
    ] as Awaited<ReturnType<typeof ProductsService.listProductCategories>>)

    mockGetPopup.mockResolvedValue(
      POPUP_BASE as Awaited<ReturnType<typeof PopupsService.getPopup>>,
    )

    // Default: no existing patreon product
    mockListProducts.mockResolvedValue({
      results: [],
      paging: { total: 0 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)
  })

  it("renders price input for ticket category (default)", async () => {
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    expect(screen.getByPlaceholderText("100.00")).toBeDefined()
  })

  it("hides price input when category is changed to patreon", async () => {
    const user = userEvent.setup()
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // Price should be visible initially (ticket is default)
    expect(screen.getByPlaceholderText("100.00")).toBeDefined()

    // The category combobox is the first one in the form (before ticket options)
    const categoryTrigger = screen.getAllByRole("combobox")[0]
    await user.click(categoryTrigger)

    const patreonOption = await screen.findByRole("option", {
      name: /patreon/i,
    })
    await user.click(patreonOption)

    // Price field must disappear
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("100.00")).toBeNull()
    })
  })

  it("submit payload contains price=0 when category is patreon", async () => {
    const user = userEvent.setup()

    mockCreateProduct.mockResolvedValue({
      id: "product-new",
      name: "Patron Support",
      price: "0",
      category: "patreon",
      slug: "patron-support",
      is_active: true,
      exclusive: false,
      popup_id: "popup-1",
      insurance_eligible: false,
    } as Awaited<ReturnType<typeof ProductsService.createProduct>>)

    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // Fill name
    await user.type(
      screen.getByPlaceholderText(/product name/i),
      "Patron Support",
    )

    // Switch to patreon — first combobox is the category selector
    const categoryTrigger = screen.getAllByRole("combobox")[0]
    await user.click(categoryTrigger)
    const patreonOption = await screen.findByRole("option", {
      name: /patreon/i,
    })
    await user.click(patreonOption)

    // Price input should be gone — submit without entering price
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("100.00")).toBeNull()
    })

    await user.click(screen.getByRole("button", { name: /create product/i }))

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            price: "0",
            category: "patreon",
          }),
        }),
      )
    })
  })

  it("disables patreon category option when popup already has an active patreon product", async () => {
    // Popup already has a patreon product
    mockListProducts.mockResolvedValue({
      results: [PRODUCT_PATREON_BASE],
      paging: { total: 1 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // Open category select — first combobox is the category selector
    const categoryTrigger = screen.getAllByRole("combobox")[0]
    await userEvent.click(categoryTrigger)

    // Patreon option should be present but disabled
    const patreonOption = await screen.findByRole("option", {
      name: /patreon/i,
    })
    expect(patreonOption).toBeDefined()
    expect(patreonOption.getAttribute("aria-disabled")).toBe("true")
  })

  it("does NOT disable patreon option when editing an existing patreon product (own product)", async () => {
    // Popup has a patreon product — but we're editing that same product
    mockListProducts.mockResolvedValue({
      results: [PRODUCT_PATREON_BASE],
      paging: { total: 1 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    render(
      <ProductForm
        defaultValues={
          PRODUCT_PATREON_BASE as Parameters<
            typeof ProductForm
          >[0]["defaultValues"]
        }
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    // The patreon category option should NOT be disabled in edit mode
    // First combobox is the category selector (in edit mode there may be only one)
    const categoryTrigger = screen.getAllByRole("combobox")[0]
    await userEvent.click(categoryTrigger)

    const patreonOption = await screen.findByRole("option", {
      name: /patreon/i,
    })
    expect(patreonOption.getAttribute("aria-disabled")).not.toBe("true")
  })
})
