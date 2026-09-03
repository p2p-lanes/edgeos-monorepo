import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import PassesProvider, { usePassesProvider } from "./passesProvider"

vi.mock("@/hooks/useCartApi", () => ({
  useCart: () => ({ data: undefined }),
}))
vi.mock("@/hooks/useGetPassesData", () => ({
  default: () => ({ products: [] }),
}))
vi.mock("@/hooks/useGetPurchases", () => ({
  usePurchasesQuery: () => ({ data: undefined }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("@/providers/discountProvider", () => ({
  useDiscount: () => ({
    discountApplied: { discount_value: 0 },
  }),
}))

describe("PassesProvider Sales Flow boundary", () => {
  it("clears selections before initializing the newly selected flow", async () => {
    const attendee = {
      id: "attendee-1",
      name: "Taylor Buyer",
      category: "main",
    } as AttendeePassState
    const product = {
      id: "pass-1",
      name: "Festival Pass",
      category: "ticket",
      duration_type: "full",
      is_active: true,
      price: 100,
      compare_price: null,
      max_per_order: 1,
    } as ProductsPass
    let salesFlowId = "flow-main"
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <PassesProvider
        attendees={[attendee]}
        flowType="application"
        productsOverride={[product]}
        salesFlowId={salesFlowId}
      >
        {children}
      </PassesProvider>
    )

    const { result, rerender } = renderHook(() => usePassesProvider(), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.attendeePasses).toHaveLength(1))

    act(() => result.current.toggleProduct(attendee.id, product))
    expect(result.current.attendeePasses[0]?.products[0]?.selected).toBe(true)

    salesFlowId = "flow-partner"
    rerender()

    await waitFor(() => {
      expect(result.current.attendeePasses).toHaveLength(1)
      expect(result.current.attendeePasses[0]?.products[0]?.selected).toBe(
        false,
      )
    })
  })
})
