import { describe, expect, it, vi } from "vitest"
import type { TicketingStepPublic } from "@/client"
import { stepOffersSomething } from "./DynamicProductStep"

vi.mock("@/client", () => ({
  AccommodationsService: {
    checkAccommodationAvailability: vi.fn(),
    checkPortalAccommodationAvailability: vi.fn(),
    listCheckoutAccommodations: vi.fn(),
    listPortalAccommodations: vi.fn(),
  },
  CheckoutService: {
    checkAccommodationAvailability: vi.fn(),
    listCheckoutAccommodations: vi.fn(),
  },
}))

function makeStep(
  templateConfig: Record<string, unknown> | null,
): TicketingStepPublic {
  return {
    id: "step-1",
    step_type: "tickets",
    template: "ticket-select",
    template_config: templateConfig,
  } as unknown as TicketingStepPublic
}

const CATALOG = [{ id: "product-a" }, { id: "product-b" }]

describe("stepOffersSomething", () => {
  it("is false when the sections name no product at all", () => {
    // The shape a flow has before anyone assigns products to it. The
    // gathering still has a catalog, which is what used to carry this step
    // past the empty check and into rendering nothing.
    const step = makeStep({
      sections: [
        { key: "full", product_ids: [] },
        { key: "day", product_ids: [] },
      ],
    })

    expect(stepOffersSomething(step, CATALOG)).toBe(false)
  })

  it("is true when a section names a product the catalog still returns", () => {
    const step = makeStep({
      sections: [{ key: "full", product_ids: ["product-b"] }],
    })

    expect(stepOffersSomething(step, CATALOG)).toBe(true)
  })

  it("is false when every named product has left the catalog", () => {
    // Deactivated, sold out of the buyer's view, or filtered out by the
    // flow's restriction rule — the section still names them and there is
    // still nothing to show.
    const step = makeStep({
      sections: [{ key: "full", product_ids: ["gone"] }],
    })

    expect(stepOffersSomething(step, CATALOG)).toBe(false)
  })

  it("judges a step that never described itself in sections on its catalog", () => {
    expect(stepOffersSomething(makeStep(null), CATALOG)).toBe(true)
    expect(stepOffersSomething(makeStep({}), CATALOG)).toBe(true)
    expect(stepOffersSomething(makeStep({ sections: [] }), CATALOG)).toBe(true)
    expect(stepOffersSomething(makeStep(null), [])).toBe(false)
  })
})
