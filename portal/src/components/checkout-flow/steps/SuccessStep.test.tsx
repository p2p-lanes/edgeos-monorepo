import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import SuccessStep from "./SuccessStep"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ slug: "summer-camp" }),
  }),
}))
vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    salesFlowId: "flow-id",
    salesFlowSlug: "attendee",
  }),
}))

describe("SuccessStep", () => {
  it("retries a failed payment through the selected Shop flow", () => {
    render(<SuccessStep paymentStatus="rejected" />)

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }))

    expect(push).toHaveBeenCalledWith("/portal/summer-camp/shop/attendee")
  })
})
