import { render, screen } from "@testing-library/react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ProductsPass } from "@/types/Products"

const useTicketsStep = vi.hoisted(() => vi.fn())

vi.mock("@/hooks/checkout/useTicketsStep", () => ({ useTicketsStep }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}))

import VariantTicketCard from "./VariantTicketCard"

describe("VariantTicketCard section layout", () => {
  it("keeps the compact desktop width and uses a subtle semantic border", () => {
    const product = {
      id: "weekend-pass",
      name: "Weekend Pass",
      price: 125,
    } as unknown as ProductsPass
    useTicketsStep.mockReturnValue({
      mode: "simple_quantity",
      attendees: [],
      sections: [
        {
          key: "passes",
          label: "Passes",
          rows: [
            {
              product,
              quantity: 0,
              selected: false,
              purchased: false,
              usesStepper: true,
              disabled: false,
              maxQuantity: 1,
              saleState: "on_sale",
            },
          ],
        },
      ],
      toggleRow: vi.fn(),
      setRowQuantity: vi.fn(),
      isEditing: false,
    })

    const { container } = render(
      createElement(VariantTicketCard, {
        products: [product],
        stepType: "tickets",
      }),
    )

    const card = container.querySelector("article")
    expect(card?.parentElement?.className).toContain("sm:w-[340px]")
    expect(card?.className).toContain("after:border-border")
    expect((card as HTMLElement)?.style.getPropertyValue("--border")).toBe(
      "color-mix(in srgb, currentColor 10%, transparent)",
    )
    expect((card as HTMLElement)?.getAttribute("style")).not.toMatch(
      /black|#000/,
    )

    const addControl = screen.getByRole("button", { name: "Add item" })
    expect(addControl.className).toContain("w-8")
    expect(addControl.className).toContain("h-8")
  })
})
