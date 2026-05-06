/**
 * Tests for the refactored useCheckoutSteps hook with resolver-map-based visibility.
 * These tests use the NEW signature: productsByStepId replaces patronCount/housingCount/merchCount.
 */
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
    title: overrides.step_type,
    description: null,
    order: 0,
    is_enabled: overrides.is_enabled ?? true,
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

function makeProductsByStepId(
  entries: Array<[string, ProductsPass[]]>,
): Map<string, ProductsPass[]> {
  return new Map(entries)
}

describe("useCheckoutSteps — resolver-map-based visibility (new signature)", () => {
  it("hides a product step when its resolver entry is empty", () => {
    const steps = [
      makeStep({ id: "step-merch", step_type: "merch", product_category: "merch", template: "merch-image" }),
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    const productsByStepId = makeProductsByStepId([
      ["step-merch", []],
      ["step-confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).not.toContain("merch")
    expect(result.current.availableSteps).toContain("confirm")
  })

  it("shows a product step when its resolver entry has at least one product", () => {
    const steps = [
      makeStep({ id: "step-merch", step_type: "merch", product_category: "merch", template: "merch-image" }),
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    const productsByStepId = makeProductsByStepId([
      ["step-merch", [makeProduct({ id: "p1", category: "merch" })]],
      ["step-confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toContain("merch")
    expect(result.current.availableSteps).toContain("confirm")
  })

  it("shows a content-only template step (faqs) even when resolver entry is empty", () => {
    const steps = [
      makeStep({ id: "step-faq", step_type: "content", template: "faqs", product_category: null }),
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    const productsByStepId = makeProductsByStepId([
      ["step-faq", []],
      ["step-confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toContain("content")
    expect(result.current.availableSteps).toContain("confirm")
  })

  it("shows a youtube-video step even when resolver entry is empty", () => {
    const steps = [
      makeStep({ id: "step-yt", step_type: "media", template: "youtube-video", product_category: null }),
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    const productsByStepId = makeProductsByStepId([
      ["step-yt", []],
      ["step-confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toContain("media")
  })

  it("always shows confirm step when is_enabled=true, regardless of resolver", () => {
    const steps = [
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    const productsByStepId = makeProductsByStepId([["step-confirm", []]])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toContain("confirm")
  })

  it("hides a step when is_enabled=false", () => {
    const steps = [
      makeStep({ id: "step-merch", step_type: "merch", product_category: "merch", template: "merch-image", is_enabled: false }),
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    const productsByStepId = makeProductsByStepId([
      ["step-merch", [makeProduct({ id: "p1", category: "merch" })]],
      ["step-confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).not.toContain("merch")
  })

  it("shows a custom step (step_type='villa') when its resolver entry has products", () => {
    const steps = [
      makeStep({ id: "step-villa", step_type: "villa", product_category: "villa", template: "merch-image" }),
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    const productsByStepId = makeProductsByStepId([
      ["step-villa", [makeProduct({ id: "p1", category: "villa" })]],
      ["step-confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toContain("villa")
  })

  it("shows the tickets step regardless of resolver output (structural step)", () => {
    const steps = [
      makeStep({ id: "step-tickets", step_type: "tickets", product_category: "ticket", template: "ticket-select" }),
      makeStep({ id: "step-confirm", step_type: "confirm" }),
    ]
    // Resolver returns empty (no ticket products)
    const productsByStepId = makeProductsByStepId([
      ["step-tickets", []],
      ["step-confirm", []],
    ])

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: steps,
        productsByStepId,
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    // tickets maps to "passes" in toCheckoutStep
    expect(result.current.availableSteps).toContain("passes")
  })

  it("falls back to ['passes', 'confirm'] when configuredSteps is empty", () => {
    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps: [],
        productsByStepId: new Map(),
        selectedPassesCount: 0,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toEqual(["passes", "confirm"])
  })
})
