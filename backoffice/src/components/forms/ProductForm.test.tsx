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
const mockUpdateProduct = vi.mocked(ProductsService.updateProduct)
const mockListProducts = vi.mocked(ProductsService.listProducts)

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

function editProduct(
  fulfillmentType: "access" | "participant" | "order" | null,
) {
  return {
    id: `product-${fulfillmentType ?? "legacy"}`,
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    name: "Existing product",
    slug: "existing-product",
    price: "50.00",
    category: "other",
    fulfillment_type: fulfillmentType,
    is_active: true,
    exclusive: false,
    insurance_eligible: false,
    requires_check_in: false,
  } as Parameters<typeof ProductForm>[0]["defaultValues"]
}

async function chooseFulfillment(option: "Access" | "Participant" | "Order") {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox", { name: "Fulfillment type" }))
  await user.click(
    screen.getByRole("option", { name: new RegExp(`^${option}`) }),
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

    mockListProducts.mockResolvedValue({
      results: [],
      paging: { total: 0 },
    } as Awaited<ReturnType<typeof ProductsService.listProducts>>)

    mockGetPopup.mockResolvedValue(
      POPUP_BASE as Awaited<ReturnType<typeof PopupsService.getPopup>>,
    )
    mockUpdateProduct.mockResolvedValue(
      editProduct("participant") as Awaited<
        ReturnType<typeof ProductsService.updateProduct>
      >,
    )
  })

  it("shows the required ownership-neutral fulfillment selector", async () => {
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    const selector = await screen.findByRole("combobox", {
      name: "Fulfillment type",
    })
    expect(selector).toHaveTextContent("Select fulfillment type")
    expect(
      screen.getByText("Choose how purchases are owned and fulfilled."),
    ).toBeInTheDocument()

    await userEvent.click(selector)
    expect(screen.getByRole("option", { name: /^Access/ })).toHaveTextContent(
      "Grants event access to one participant.",
    )
    expect(
      screen.getByRole("option", { name: /^Participant/ }),
    ).toHaveTextContent(
      "Stores per-participant metadata without granting access.",
    )
    expect(screen.getByRole("option", { name: /^Order/ })).toHaveTextContent(
      "Owned once at the order level.",
    )
  })

  it("blocks new product submission until fulfillment is selected", async () => {
    const user = userEvent.setup()
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })
    await user.type(
      await screen.findByPlaceholderText(/product name/i),
      "Untyped",
    )
    await user.type(screen.getByPlaceholderText("100.00"), "50")

    await user.click(screen.getByRole("button", { name: /create product/i }))

    expect(
      await screen.findByText("Fulfillment type is required"),
    ).toBeInTheDocument()
    expect(mockCreateProduct).not.toHaveBeenCalled()
  })

  it.each([
    "Access",
    "Participant",
    "Order",
  ] as const)("submits the selected %s fulfillment type on create", async (option) => {
    const user = userEvent.setup()
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })
    await user.type(
      await screen.findByPlaceholderText(/product name/i),
      `${option} item`,
    )
    await user.type(screen.getByPlaceholderText("100.00"), "50")
    await chooseFulfillment(option)

    await user.click(screen.getByRole("button", { name: /create product/i }))

    await waitFor(() =>
      expect(mockCreateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            fulfillment_type: option.toLowerCase(),
          }),
        }),
      ),
    )
  })

  it("displays and preserves an existing fulfillment type", async () => {
    const user = userEvent.setup()
    render(
      <ProductForm
        defaultValues={editProduct("participant")}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    expect(
      await screen.findByRole("combobox", { name: "Fulfillment type" }),
    ).toHaveTextContent("Participant")
    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() =>
      expect(mockUpdateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            fulfillment_type: "participant",
          }),
        }),
      ),
    )
  })

  it("omits fulfillment type from unrelated updates to a legacy product", async () => {
    const user = userEvent.setup()
    render(
      <ProductForm defaultValues={editProduct(null)} onSuccess={vi.fn()} />,
      {
        wrapper: makeWrapper(),
      },
    )
    await user.type(
      await screen.findByPlaceholderText(/product name/i),
      " renamed",
    )

    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => expect(mockUpdateProduct).toHaveBeenCalledOnce())
    expect(mockUpdateProduct.mock.calls[0]?.[0].requestBody).not.toHaveProperty(
      "fulfillment_type",
    )
  })

  it("classifies a legacy product when a fulfillment type is selected", async () => {
    const user = userEvent.setup()
    render(
      <ProductForm defaultValues={editProduct(null)} onSuccess={vi.fn()} />,
      {
        wrapper: makeWrapper(),
      },
    )
    await screen.findByPlaceholderText(/product name/i)
    await chooseFulfillment("Order")

    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() =>
      expect(mockUpdateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ fulfillment_type: "order" }),
        }),
      ),
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

    await chooseFulfillment("Access")

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
