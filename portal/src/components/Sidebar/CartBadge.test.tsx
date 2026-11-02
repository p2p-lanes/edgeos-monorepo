import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let city: { id: string; slug: string; status: string } | null = null
const useCart = vi.fn()

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => city }),
}))

vi.mock("@/hooks/useCartApi", () => ({
  useCart: (popupId: string | null) => useCart(popupId),
  useClearCart: () => ({ mutate: vi.fn(), isPending: false }),
}))

import CartBadge from "./CartBadge"

const cartWithPass = {
  data: {
    lines: [
      { kind: "product", step_type: "tickets", product_id: "p1", quantity: 1 },
    ],
  },
}

afterEach(cleanup)

beforeEach(() => {
  useCart.mockReset()
  useCart.mockImplementation((popupId: string | null) =>
    popupId ? cartWithPass : { data: undefined },
  )
})

describe("CartBadge", () => {
  it("shows the cart for an active popup", () => {
    city = { id: "popup-1", slug: "summit", status: "active" }
    render(<CartBadge />)

    expect(useCart).toHaveBeenCalledWith("popup-1")
    expect(screen.getByLabelText("cartBadge.aria_open")).toBeTruthy()
  })

  it("hides the cart and skips the fetch for an ended popup", () => {
    city = { id: "popup-1", slug: "summit", status: "ended" }
    render(<CartBadge />)

    expect(useCart).toHaveBeenCalledWith(null)
    expect(screen.queryByLabelText("cartBadge.aria_open")).toBeNull()
  })
})
