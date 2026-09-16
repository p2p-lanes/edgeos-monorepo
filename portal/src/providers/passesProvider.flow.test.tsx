import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  type AttendeePurchases,
  CancelablePromise,
  PaymentsService,
  type ProductsListPortalProductsResponse,
  ProductsService,
} from "@/client"
import { useProductsQuery } from "@/hooks/useProductsQuery"
import { queryKeys } from "@/lib/query-keys"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import PassesProvider, { usePassesProvider } from "./passesProvider"

vi.mock("@/hooks/useCartApi", () => ({
  useCart: () => ({ data: undefined }),
}))
vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => true,
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("@/providers/discountProvider", () => ({
  useDiscount: () => ({
    discountApplied: { discount_value: 0 },
  }),
}))

let client: QueryClient
const QueryWrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(ProductsService, "listPortalProducts").mockResolvedValue({
    results: [],
  } as never)
  vi.spyOn(PaymentsService, "listMyPaymentsByPopup").mockResolvedValue({
    results: [],
  } as never)
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("PassesProvider override query ownership", () => {
  const product = {
    id: "runtime-product",
    price: 10,
    category: "ticket",
    is_active: true,
  } as ProductsPass
  const purchase: AttendeePurchases = {
    attendee_id: "attendee-1",
    attendee_name: "Buyer",
    attendee_category: "main",
    products: [],
  }

  it.each([false, true])("uses overrides: nonempty=%s", async (nonempty) => {
    let productsOverride: ProductsPass[] | undefined = nonempty ? [product] : []
    let purchasesOverride: AttendeePurchases[] | undefined = nonempty
      ? [purchase]
      : []
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryWrapper>
        <PassesProvider
          attendees={[]}
          productsOverride={productsOverride}
          purchasesOverride={purchasesOverride}
          salesFlowId="flow-1"
        >
          {children}
        </PassesProvider>
      </QueryWrapper>
    )
    const { result, rerender } = renderHook(() => usePassesProvider(), {
      wrapper: Wrapper,
    })
    await act(async () => {
      await client.invalidateQueries()
    })
    expect(result.current.products).toEqual(productsOverride)
    expect.soft(ProductsService.listPortalProducts).not.toHaveBeenCalled()
    expect.soft(PaymentsService.listMyPaymentsByPopup).not.toHaveBeenCalled()

    productsOverride = undefined
    rerender()
    await waitFor(() =>
      expect(ProductsService.listPortalProducts).toHaveBeenCalledWith({
        popupId: "popup-1",
        salesFlowId: "flow-1",
      }),
    )
    await waitFor(() => expect(result.current.products).toEqual([]))
    expect(PaymentsService.listMyPaymentsByPopup).not.toHaveBeenCalled()
    purchasesOverride = undefined
    rerender()
    await waitFor(() =>
      expect(PaymentsService.listMyPaymentsByPopup).toHaveBeenCalledWith({
        popupId: "popup-1",
      }),
    )
    await act(async () => {
      await client.invalidateQueries()
    })
    expect(ProductsService.listPortalProducts).toHaveBeenCalledTimes(2)
    expect(PaymentsService.listMyPaymentsByPopup).toHaveBeenCalledTimes(2)
  })

  it("keeps normal product polling and stale-time behavior", async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useProductsQuery("popup-1", "flow-1"), {
      wrapper: QueryWrapper,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.isStale).toBe(true)
    expect(ProductsService.listPortalProducts).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(ProductsService.listPortalProducts).toHaveBeenCalledTimes(2)
    expect(
      client.getQueryData(queryKeys.products.byPopup("popup-1", "flow-1")),
    ).toEqual([])
  })

  it("allows an independent observer to fetch while a disabled observer shares its pending state", async () => {
    vi.mocked(ProductsService.listPortalProducts).mockImplementation(
      () => new CancelablePromise<ProductsListPortalProductsResponse>(() => {}),
    )
    const { result } = renderHook(
      () => {
        useProductsQuery("popup-1", "flow-1")
        return useProductsQuery("popup-1", "flow-1", false)
      },
      { wrapper: QueryWrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(true))
    expect(ProductsService.listPortalProducts).toHaveBeenCalledTimes(1)
  })
})

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
      wrapper: ({ children }) => (
        <QueryWrapper>
          <Wrapper>{children}</Wrapper>
        </QueryWrapper>
      ),
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
