import { Package } from "lucide-react"
import { describe, expect, it } from "vitest"
import type { TicketingStepPublic } from "@/client"
import { getRegistryIcon } from "@/lib/checkoutStepIcons"
import { resolveOtherProductVisual } from "./otherProductVisual"

const lunch = { id: "lunch-1", category: "Lunch" }

const step = (overrides: Partial<TicketingStepPublic> = {}) =>
  ({
    id: "step-lunch",
    step_type: "lunch",
    title: "Lunch",
    product_category: "lunch",
    template: "ticket-card",
    emoji: null,
    template_config: null,
    ...overrides,
  }) as unknown as TicketingStepPublic

describe("resolveOtherProductVisual", () => {
  it("uses the product's own image first", () => {
    const visual = resolveOtherProductVisual(
      lunch,
      [step()],
      [{ id: "lunch-1", image_url: "https://img/product.png" }],
    )

    expect(visual.imageUrl).toBe("https://img/product.png")
  })

  it("falls back to the image of the card the product was sold under", () => {
    const visual = resolveOtherProductVisual(
      lunch,
      [
        step({
          template_config: {
            sections: [
              {
                key: "w2",
                product_ids: ["other"],
                image_url: "https://img/w2",
              },
              {
                key: "w1",
                product_ids: ["lunch-1"],
                image_url: "https://img/w1",
              },
            ],
          },
        }),
      ],
      [{ id: "lunch-1", image_url: null }],
    )

    expect(visual.imageUrl).toBe("https://img/w1")
  })

  it("shows the icon picked for the step that sells the category", () => {
    const visual = resolveOtherProductVisual(
      lunch,
      [step({ emoji: "utensils" })],
      [],
    )

    expect(visual.imageUrl).toBeNull()
    expect(visual.Icon).toBe(getRegistryIcon("utensils"))
    expect(visual.Icon).not.toBeNull()
  })

  it("ignores the confirm step and keeps the box when nothing matches", () => {
    const visual = resolveOtherProductVisual(
      lunch,
      [step({ step_type: "confirm" }), step({ product_category: "merch" })],
      [],
    )

    expect(visual).toEqual({ imageUrl: null, Icon: Package })
  })
})
