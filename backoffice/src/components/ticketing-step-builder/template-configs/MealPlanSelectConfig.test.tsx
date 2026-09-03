import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProductPublic } from "@/client"
import { ProductsService } from "@/client"
import { MealPlanSelectConfig } from "./MealPlanSelectConfig"

vi.mock("@/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client")>()
  return {
    ...actual,
    ProductsService: {
      listProducts: vi.fn(),
    },
  }
})

const products: ProductPublic[] = [
  ["participant-product", "Participant Meal"],
  ["access-product", "Access Meal"],
  ["order-product", "Order Meal"],
  ["legacy-product", "Legacy Meal"],
].map(([id, name]) => ({
  id,
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  name,
  slug: id,
  price: "25.00",
  category: "meal_plan",
  is_active: true,
}))

function mealConfig(productIds: string[] = []) {
  return {
    sections: [
      {
        key: "week-one",
        label: "Week One",
        order: 0,
        products: productIds.map((productId) => ({
          product_id: productId,
          coverage_start: "2026-09-01",
          coverage_end: "2026-09-07",
          menu_options: [],
        })),
      },
    ],
  }
}

function renderConfig(productIds: string[] = [], onChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MealPlanSelectConfig
        config={mealConfig(productIds)}
        onChange={onChange}
        popupId="popup-1"
        productCategory="meal_plan"
      />
    </QueryClientProvider>,
  )
  return onChange
}

describe("MealPlanSelectConfig", () => {
  beforeEach(() => {
    vi.mocked(ProductsService.listProducts).mockResolvedValue({
      results: products,
      paging: { limit: 200, offset: 0, total: products.length },
    })
  })

  it("offers all meal-plan products", async () => {
    const user = userEvent.setup()
    const onChange = renderConfig()

    const addProduct = await screen.findByRole("button", {
      name: "Add product",
    })
    await waitFor(() => expect(addProduct).toBeEnabled())
    await user.click(addProduct)

    const participantChoice = screen.getByRole("button", {
      name: /Participant Meal/,
    })
    expect(screen.getByText("Access Meal")).toBeInTheDocument()
    expect(screen.getByText("Order Meal")).toBeInTheDocument()
    expect(screen.getByText("Legacy Meal")).toBeInTheDocument()
    expect(ProductsService.listProducts).toHaveBeenCalledWith({
      popupId: "popup-1",
      limit: 200,
      category: "meal_plan",
    })

    await user.click(participantChoice)

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            products: [
              expect.objectContaining({ product_id: "participant-product" }),
            ],
          }),
        ],
      }),
    )
  })

  it("keeps configured meal-plan products visible without legacy warnings", async () => {
    const onChange = renderConfig(["access-product", "legacy-product"])

    expect(await screen.findByText("Access Meal")).toBeInTheDocument()
    expect(screen.getByText("Legacy Meal")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps a missing configured product visible for repair", async () => {
    const onChange = renderConfig(["missing-product"])

    expect(
      await screen.findByText("Product not found (missing-)", { exact: false }),
    ).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
