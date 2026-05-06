import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { TicketingStepPublic } from "@/client"
import type { ProductsPass } from "@/types/Products"
import { useCheckoutSteps } from "./useCheckoutSteps"

function makeStep(
  overrides: Partial<TicketingStepPublic> & { step_type: string },
): TicketingStepPublic {
  return {
    id: overrides.id ?? overrides.step_type,
    popup_id: "popup-id",
    tenant_id: "tenant-id",
    step_type: overrides.step_type,
    title: overrides.title ?? overrides.step_type,
    description: overrides.description ?? null,
    order: overrides.order ?? 0,
    is_enabled: overrides.is_enabled ?? true,
    protected: overrides.protected ?? false,
    product_category: overrides.product_category ?? null,
    template: overrides.template ?? null,
    template_config: overrides.template_config ?? null,
    watermark: overrides.watermark ?? null,
    show_title: overrides.show_title ?? true,
    show_watermark: overrides.show_watermark ?? true,
  } as TicketingStepPublic
}

function makeProduct(
  overrides: Partial<ProductsPass> & { id: string; category: string },
): ProductsPass {
  const { id, category, ...rest } = overrides
  return {
    name: id,
    is_active: true,
    price: 10,
    compare_price: null,
    max_quantity: null,
    ...rest,
    id,
    category,
  } as unknown as ProductsPass
}

describe("useCheckoutSteps", () => {
  it("includes all configured known steps in availableSteps", () => {
    const configuredSteps = [
      makeStep({ step_type: "tickets", order: 0 }),
      makeStep({ step_type: "confirm", order: 1 }),
    ]
    const productsByStepId = new Map<string, ProductsPass[]>([
      ["tickets", []],
      ["confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps,
        productsByStepId,
        selectedPassesCount: 1,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toEqual(["passes", "confirm"])
  })

  it("keeps housing step when resolver entry has products", () => {
    const configuredSteps = [
      makeStep({ step_type: "tickets", order: 0 }),
      makeStep({
        id: "housing",
        step_type: "housing",
        order: 1,
        product_category: "housing",
        template: "housing-date",
      }),
      makeStep({ step_type: "confirm", order: 2 }),
    ]
    const productsByStepId = new Map<string, ProductsPass[]>([
      ["tickets", []],
      [
        "housing",
        [
          makeProduct({ id: "h1", category: "housing" }),
          makeProduct({ id: "h2", category: "housing" }),
        ],
      ],
      ["confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps,
        productsByStepId,
        selectedPassesCount: 1,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toEqual([
      "passes",
      "housing",
      "confirm",
    ])
  })

  it("excludes housing and merch when resolver entries are empty", () => {
    const configuredSteps = [
      makeStep({ step_type: "tickets", order: 0 }),
      makeStep({
        id: "housing",
        step_type: "housing",
        order: 1,
        product_category: "housing",
        template: "housing-date",
      }),
      makeStep({
        id: "merch",
        step_type: "merch",
        order: 2,
        product_category: "merch",
        template: "merch-image",
      }),
      makeStep({ step_type: "confirm", order: 3 }),
    ]
    const productsByStepId = new Map<string, ProductsPass[]>([
      ["tickets", []],
      ["housing", []],
      ["merch", []],
      ["confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps,
        productsByStepId,
        selectedPassesCount: 1,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    // housing and merch filtered because resolver entries are empty
    expect(result.current.availableSteps).toEqual(["passes", "confirm"])
  })
})
