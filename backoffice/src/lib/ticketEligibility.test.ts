import { describe, expect, it } from "vitest"

import type { ProductPublic, TicketingStepPublic } from "@/client"
import {
  computeTicketEligibility,
  isProductAssignable,
} from "@/lib/ticketEligibility"

function step(partial: Partial<TicketingStepPublic>): TicketingStepPublic {
  return {
    id: "s",
    tenant_id: "t",
    popup_id: "p",
    step_type: "tickets",
    title: "Tickets",
    template: "ticket-select",
    product_category: "ticket",
    ...partial,
  } as TicketingStepPublic
}

function product(id: string, category = "ticket"): ProductPublic {
  return { id, category } as ProductPublic
}

const CAT_A = "11111111-1111-1111-1111-111111111111"
const CAT_B = "22222222-2222-2222-2222-222222222222"

describe("computeTicketEligibility + isProductAssignable", () => {
  it("section open to all (attendee_categories null) is eligible for any category", () => {
    const steps = [
      step({
        template_config: {
          sections: [{ product_ids: ["p1"], attendee_categories: null }],
        },
      }),
    ]
    const elig = computeTicketEligibility(steps, CAT_A)
    expect(isProductAssignable(product("p1"), elig)).toBe(true)
  })

  it("section scoped to a category gates by the attendee's category id", () => {
    const steps = [
      step({
        template_config: {
          sections: [{ product_ids: ["p1"], attendee_categories: [CAT_A] }],
        },
      }),
    ]
    const eligA = computeTicketEligibility(steps, CAT_A)
    const eligB = computeTicketEligibility(steps, CAT_B)
    expect(isProductAssignable(product("p1"), eligA)).toBe(true)
    expect(isProductAssignable(product("p1"), eligB)).toBe(false)
  })

  it("a ticket product not in any section is hidden (segmented category)", () => {
    const steps = [
      step({
        template_config: {
          sections: [{ product_ids: ["p1"], attendee_categories: null }],
        },
      }),
    ]
    const elig = computeTicketEligibility(steps, CAT_A)
    expect(isProductAssignable(product("p2"), elig)).toBe(false)
  })

  it("non-segmented categories (e.g. housing) pass through", () => {
    const steps = [
      step({
        template_config: {
          sections: [{ product_ids: ["p1"], attendee_categories: [CAT_A] }],
        },
      }),
    ]
    const elig = computeTicketEligibility(steps, CAT_B)
    expect(isProductAssignable(product("h1", "housing"), elig)).toBe(true)
  })

  it("disabled steps and non-ticket-select templates are ignored (no filtering)", () => {
    const steps = [
      step({
        is_enabled: false,
        template_config: {
          sections: [{ product_ids: ["p1"], attendee_categories: [CAT_A] }],
        },
      }),
      step({ template: "merch-image", product_category: "merch" }),
    ]
    const elig = computeTicketEligibility(steps, CAT_B)
    // No active ticket-select step → "ticket" is not segmented → passes through.
    expect(isProductAssignable(product("p1"), elig)).toBe(true)
  })
})
