/**
 * Tests for ProductForm — requires_check_in visible for all categories
 *
 * Covers:
 *   (a) toggle renders when category === "ticket" (default)
 *   (b) toggle renders when category === "merch"
 *   (c) toggle renders when category === "housing"
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
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

function getRequiresCheckInToggle(): Element | null {
  return (
    document.querySelector('[id="requires_check_in"]') ??
    screen.queryByRole("switch", { name: /requires check.in/i })
  )
}

describe("ProductForm — requires_check_in for all categories", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPopup.mockResolvedValue(
      POPUP_NO_TIER as Awaited<ReturnType<typeof PopupsService.getPopup>>,
    )
    mockListProductCategories.mockResolvedValue([
      "ticket",
      "merch",
      "housing",
    ] as Awaited<ReturnType<typeof ProductsService.listProductCategories>>)
  })

  it("(a) renders Requires Check-in toggle for category=ticket (default)", async () => {
    render(<ProductForm onSuccess={vi.fn()} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    expect(getRequiresCheckInToggle()).not.toBeNull()
  })

  it("(b) renders Requires Check-in toggle when category === 'merch'", async () => {
    render(
      <ProductForm
        onSuccess={vi.fn()}
        defaultValues={
          {
            id: "p1",
            name: "My Merch",
            price: 20,
            category: "merch",
            slug: "my-merch",
            is_active: true,
            exclusive: false,
            popup_id: "popup-1",
            insurance_eligible: false,
            requires_check_in: false,
          } as Parameters<typeof ProductForm>[0]["defaultValues"]
        }
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    expect(getRequiresCheckInToggle()).not.toBeNull()
  })

  it("(c) renders Requires Check-in toggle when category === 'housing'", async () => {
    render(
      <ProductForm
        onSuccess={vi.fn()}
        defaultValues={
          {
            id: "p2",
            name: "My Housing",
            price: 30,
            category: "housing",
            slug: "my-housing",
            is_active: true,
            exclusive: false,
            popup_id: "popup-1",
            insurance_eligible: false,
            requires_check_in: false,
          } as Parameters<typeof ProductForm>[0]["defaultValues"]
        }
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => screen.getByPlaceholderText(/product name/i), {
      timeout: 3000,
    })

    expect(getRequiresCheckInToggle()).not.toBeNull()
  })
})
