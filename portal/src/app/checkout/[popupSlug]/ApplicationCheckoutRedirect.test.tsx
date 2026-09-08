import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () =>
    new URLSearchParams("lang=es&cid=cart&sig=proof&checkout=success"),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

import { ApplicationCheckoutRedirect } from "./ApplicationCheckoutRedirect"

describe("ApplicationCheckoutRedirect", () => {
  beforeEach(() => {
    replace.mockReset()
    window.history.replaceState(null, "", "/")
  })

  it.each([
    [
      "attendee-flow-id",
      "/portal/spring-fest/shop/attendee-flow-id?lang=es&cid=cart&sig=proof&checkout=success",
    ],
    [
      "volunteer-flow-id",
      "/portal/spring-fest/shop/volunteer-flow-id?lang=es&cid=cart&sig=proof&checkout=success",
    ],
  ])("hands authenticated flow %s directly to canonical Shop", (flowSlug, target) => {
    render(
      <ApplicationCheckoutRedirect
        popupSlug="spring-fest"
        flowSlug={flowSlug}
      />,
    )

    expect(replace).toHaveBeenCalledWith(target)
  })
  it("preserves the hash across the public application handoff", () => {
    window.history.replaceState(null, "", "/#confirm")
    render(
      <ApplicationCheckoutRedirect
        popupSlug="spring-fest"
        flowSlug="attendee"
      />,
    )
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith(
      "/portal/spring-fest/shop/attendee?lang=es&cid=cart&sig=proof&checkout=success#confirm",
    )
    window.history.replaceState(null, "", "/")
  })
})
