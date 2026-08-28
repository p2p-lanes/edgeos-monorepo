import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FulfillmentType, ProductPublic } from "@/client"
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
  ["participant-product", "Participant Meal", "participant"],
  ["access-product", "Access Meal", "access"],
  ["order-product", "Order Meal", "order"],
  ["legacy-product", "Legacy Meal", null],
].map(([id, name, fulfillmentType]) => ({
  id,
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  name,
  slug: id,
  price: "25.00",
  category: "meal_plan",
  is_active: true,
  fulfillment_type: fulfillmentType as FulfillmentType | null,
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
      count: products.length,
    })
  })

  it("offers only participant products as new meal references", async () => {
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
    expect(screen.queryByText("Access Meal")).not.toBeInTheDocument()
    expect(screen.queryByText("Order Meal")).not.toBeInTheDocument()
    expect(screen.queryByText("Legacy Meal")).not.toBeInTheDocument()
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

  it("keeps configured non-participant and legacy products visible for repair", async () => {
    const onChange = renderConfig(["access-product", "legacy-product"])

    expect(await screen.findByText("Access Meal")).toBeInTheDocument()
    expect(screen.getByText("Legacy Meal")).toBeInTheDocument()
    expect(
      screen.getAllByRole("alert", {
        name: "Invalid meal product fulfillment",
      }),
    ).toHaveLength(2)
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
