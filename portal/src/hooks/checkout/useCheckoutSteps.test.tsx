import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { TicketingStepPublic } from "@/client"
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
    created_at: overrides.created_at ?? "2026-04-17T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-04-17T00:00:00Z",
  } as TicketingStepPublic
}

describe("useCheckoutSteps", () => {
  it("includes all configured known steps in availableSteps", () => {
    const configuredSteps = [
      makeStep({ step_type: "tickets", order: 0 }),
      makeStep({ step_type: "confirm", order: 1 }),
    ]

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps,
        patronCount: 0,
        housingCount: 0,
        merchCount: 0,
        selectedPassesCount: 1,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    expect(result.current.availableSteps).toEqual(["passes", "confirm"])
  })

  it("keeps other known steps when present", () => {
    const configuredSteps = [
      makeStep({ step_type: "tickets", order: 0 }),
      makeStep({ step_type: "housing", order: 1 }),
      makeStep({ step_type: "confirm", order: 2 }),
    ]

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps,
        patronCount: 0,
        housingCount: 2,
        merchCount: 0,
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

  it("excludes housing and merch when no products available", () => {
    const configuredSteps = [
      makeStep({ step_type: "tickets", order: 0 }),
      makeStep({ step_type: "housing", order: 1 }),
      makeStep({ step_type: "merch", order: 2 }),
      makeStep({ step_type: "confirm", order: 3 }),
    ]

    const { result } = renderHook(() =>
      useCheckoutSteps({
        initialStep: "passes",
        configuredSteps,
        patronCount: 0,
        housingCount: 0,
        merchCount: 0,
        selectedPassesCount: 1,
        dynamicItemsCount: 0,
        isEditing: false,
      }),
    )

    // housing and merch filtered because counts = 0
    expect(result.current.availableSteps).toEqual(["passes", "confirm"])
  })
})
