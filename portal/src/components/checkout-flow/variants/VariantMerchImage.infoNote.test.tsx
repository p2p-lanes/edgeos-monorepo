/**
 * In the compact merch list the whole card is the "add to cart" button, so
 * the product info note (SIM-37) sits inside it. Opening the note must not
 * add the product.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProductsPass } from "@/types/Products"
import VariantMerchImage from "./VariantMerchImage"

const updateMerchQuantity = vi.fn()

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && "name" in vars ? `${key}:${vars.name}` : key,
  }),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({ cart: { merch: [] }, updateMerchQuantity }),
}))

const NOTE = "Sizes run small."

const tee = {
  id: "tee",
  tenant_id: "t1",
  popup_id: "pop1",
  name: "Tee",
  slug: "tee",
  price: 20,
  category: "merch",
  is_active: true,
  info_note: NOTE,
} as ProductsPass

describe("VariantMerchImage info note", () => {
  beforeEach(() => updateMerchQuantity.mockClear())

  it("opens inside the card button without adding the product", () => {
    render(
      <VariantMerchImage
        products={[tee]}
        stepType="merch"
        templateConfig={{ variant: "compact" }}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "checkout.product_info_note_label:Tee",
      }),
    )

    expect(screen.getByText(NOTE)).toBeTruthy()
    expect(updateMerchQuantity).not.toHaveBeenCalled()

    // The card itself still adds it.
    fireEvent.click(screen.getByRole("button", { name: "Add Tee to cart" }))
    expect(updateMerchQuantity).toHaveBeenCalledWith("tee", 1)
  })
})
