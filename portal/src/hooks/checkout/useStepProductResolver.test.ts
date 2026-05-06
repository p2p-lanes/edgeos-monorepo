import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { TicketingStepPublic } from "@/client"
import type { ProductsPass } from "@/types/Products"
import { useStepProductResolver } from "./useStepProductResolver"

function makeStep(
  overrides: Partial<TicketingStepPublic> & { step_type: string },
): TicketingStepPublic {
  return {
    id: overrides.id ?? overrides.step_type,
    popup_id: "popup-id",
    tenant_id: "tenant-id",
    step_type: overrides.step_type,
    title: overrides.step_type,
    description: null,
    order: 0,
    is_enabled: true,
    protected: false,
    product_category: overrides.product_category ?? null,
    template: overrides.template ?? null,
    template_config: overrides.template_config ?? null,
    watermark: null,
    show_title: true,
    show_watermark: true,
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

describe("useStepProductResolver", () => {
  it("returns an empty map when configuredSteps is empty", () => {
    const { result } = renderHook(() =>
      useStepProductResolver([], [makeProduct({ id: "p1", category: "merch" })]),
    )
    expect(result.current.productsByStepId.size).toBe(0)
  })

  it("maps step.id to empty array when product_category is null on non-confirm non-content step", () => {
    const steps = [
      makeStep({
        id: "step-null",
        step_type: "merch",
        product_category: null,
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "p1", category: "merch" })]
    const { result } = renderHook(() =>
      useStepProductResolver(steps, products),
    )
    expect(result.current.productsByStepId.get("step-null")).toEqual([])
  })

  it("maps step.id to empty array for content-only templates (youtube-video)", () => {
    const steps = [
      makeStep({
        id: "step-yt",
        step_type: "content",
        product_category: null,
        template: "youtube-video",
      }),
    ]
    const products = [makeProduct({ id: "p1", category: "merch" })]
    const { result } = renderHook(() =>
      useStepProductResolver(steps, products),
    )
    expect(result.current.productsByStepId.get("step-yt")).toEqual([])
  })

  it("maps step.id to empty array for content-only templates (image-gallery)", () => {
    const steps = [
      makeStep({
        id: "step-ig",
        step_type: "content",
        product_category: null,
        template: "image-gallery",
      }),
    ]
    const { result } = renderHook(() => useStepProductResolver(steps, []))
    expect(result.current.productsByStepId.get("step-ig")).toEqual([])
  })

  it("maps step.id to empty array for content-only templates (faqs)", () => {
    const steps = [
      makeStep({
        id: "step-faq",
        step_type: "content",
        product_category: null,
        template: "faqs",
      }),
    ]
    const { result } = renderHook(() => useStepProductResolver(steps, []))
    expect(result.current.productsByStepId.get("step-faq")).toEqual([])
  })

  it("maps step.id to empty array for confirm step regardless of products", () => {
    const steps = [
      makeStep({ id: "step-confirm", step_type: "confirm", product_category: null }),
    ]
    const products = [makeProduct({ id: "p1", category: "merch" })]
    const { result } = renderHook(() =>
      useStepProductResolver(steps, products),
    )
    expect(result.current.productsByStepId.get("step-confirm")).toEqual([])
  })

  it("returns matching products for product_category='other' when products with category='other' exist", () => {
    const steps = [
      makeStep({
        id: "step-other",
        step_type: "merch",
        product_category: "other",
        template: "merch-image",
      }),
    ]
    const products = [
      makeProduct({ id: "p1", category: "other" }),
      makeProduct({ id: "p2", category: "merch" }),
    ]
    const { result } = renderHook(() =>
      useStepProductResolver(steps, products),
    )
    const resolved = result.current.productsByStepId.get("step-other")
    expect(resolved).toHaveLength(1)
    expect(resolved![0].id).toBe("p1")
  })

  it("performs case-insensitive match: product_category='MERCH' resolves products with category='merch'", () => {
    const steps = [
      makeStep({
        id: "step-merch",
        step_type: "merch",
        product_category: "MERCH",
        template: "merch-image",
      }),
    ]
    const products = [
      makeProduct({ id: "p1", category: "merch" }),
      makeProduct({ id: "p2", category: "Merch" }),
      makeProduct({ id: "p3", category: "housing" }),
    ]
    const { result } = renderHook(() =>
      useStepProductResolver(steps, products),
    )
    const resolved = result.current.productsByStepId.get("step-merch")
    expect(resolved).toHaveLength(2)
    expect(resolved!.map((p) => p.id)).toEqual(expect.arrayContaining(["p1", "p2"]))
  })

  it("two steps with the same product_category both resolve the same products (no de-dup)", () => {
    const steps = [
      makeStep({
        id: "step-merch-1",
        step_type: "merch",
        product_category: "merch",
        template: "merch-image",
      }),
      makeStep({
        id: "step-merch-2",
        step_type: "merch",
        product_category: "merch",
        template: "merch-image",
      }),
    ]
    const products = [makeProduct({ id: "p1", category: "merch" })]
    const { result } = renderHook(() =>
      useStepProductResolver(steps, products),
    )
    const resolved1 = result.current.productsByStepId.get("step-merch-1")
    const resolved2 = result.current.productsByStepId.get("step-merch-2")
    expect(resolved1).toHaveLength(1)
    expect(resolved2).toHaveLength(1)
    expect(resolved1![0].id).toBe("p1")
    expect(resolved2![0].id).toBe("p1")
  })

  it("excludes is_active=false products", () => {
    const steps = [
      makeStep({
        id: "step-merch",
        step_type: "merch",
        product_category: "merch",
        template: "merch-image",
      }),
    ]
    const products = [
      makeProduct({ id: "p1", category: "merch", is_active: true }),
      makeProduct({ id: "p2", category: "merch", is_active: false }),
    ]
    const { result } = renderHook(() =>
      useStepProductResolver(steps, products),
    )
    const resolved = result.current.productsByStepId.get("step-merch")
    expect(resolved).toHaveLength(1)
    expect(resolved![0].id).toBe("p1")
  })

  it("getProductsForStep returns [] for null/undefined step", () => {
    const { result } = renderHook(() => useStepProductResolver([], []))
    expect(result.current.getProductsForStep(null)).toEqual([])
    expect(result.current.getProductsForStep(undefined)).toEqual([])
  })

  it("getProductsForStep returns [] for unknown step id", () => {
    const steps = [
      makeStep({
        id: "step-merch",
        step_type: "merch",
        product_category: "merch",
        template: "merch-image",
      }),
    ]
    const { result } = renderHook(() => useStepProductResolver(steps, []))
    const unknownStep = makeStep({ id: "step-unknown", step_type: "custom" })
    expect(result.current.getProductsForStep(unknownStep)).toEqual([])
  })
})
