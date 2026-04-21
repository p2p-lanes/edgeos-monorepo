import { describe, expect, it } from "vitest"
import type { TicketingStepPublic } from "@/client"
import { shouldUseDynamicStep } from "./stepRegistry"

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
    created_at: "2026-04-18T00:00:00Z",
    updated_at: "2026-04-18T00:00:00Z",
  } as TicketingStepPublic
}

describe("shouldUseDynamicStep", () => {
  it("returns false for confirm step even when template_config.insurance is present", () => {
    // Regression: confirm step owns InsuranceCard internally; template_config
    // is consumed there, not via DynamicProductStep.
    const step = makeStep({
      step_type: "confirm",
      template_config: {
        insurance: {
          card_title: "Insurance",
          card_subtitle: "Change of plans coverage",
          toggle_label: "Add insurance",
          benefits: ["benefit 1"],
        },
      },
    })
    expect(shouldUseDynamicStep(step)).toBe(false)
  })

  it("returns false when step has no template_config", () => {
    expect(shouldUseDynamicStep(makeStep({ step_type: "tickets" }))).toBe(false)
  })

  it("returns true for a step with an explicit template (non-confirm)", () => {
    const step = makeStep({
      step_type: "housing",
      template: "housing-grid",
      template_config: {},
    })
    expect(shouldUseDynamicStep(step)).toBe(true)
  })

  it("returns false for confirm even with an explicit template", () => {
    // Belt-and-suspenders: confirm must never route through DynamicProductStep.
    const step = makeStep({
      step_type: "confirm",
      template: "confirm-v2",
      template_config: { foo: "bar" },
    })
    expect(shouldUseDynamicStep(step)).toBe(false)
  })
})
