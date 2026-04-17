import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  getCheckoutModeDisplay,
  PopupCheckoutModeInfo,
} from "./popupCheckoutModeInfo"

describe("popupCheckoutModeInfo", () => {
  it("shows direct-sale guidance with a read-only simple_quantity indicator", () => {
    const markup = renderToStaticMarkup(
      <PopupCheckoutModeInfo
        saleType="direct"
        checkoutMode="simple_quantity"
      />,
    )

    expect(markup).toContain("Checkout mode")
    expect(markup).toContain("simple_quantity")
    expect(markup).toContain(
      "Direct sale always derives the simple_quantity checkout flow",
    )
    expect(markup).not.toContain("<select")
  })

  it("derives pass_system copy from application sale type", () => {
    expect(
      getCheckoutModeDisplay({
        saleType: "application",
        checkoutMode: "pass_system",
      }),
    ).toEqual(
      expect.objectContaining({
        badgeLabel: "pass_system",
        mapping: "application → pass_system",
      }),
    )
  })
})
