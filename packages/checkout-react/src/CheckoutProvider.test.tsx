import type {
  CheckoutRuntimeResponse,
  Transport,
} from "@edgeos/checkout-core"
import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import { type ReactNode, StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { CheckoutProvider } from "./CheckoutProvider"
import { useCheckoutStore } from "./context"
import { useCheckout, useCart, usePreview } from "./hooks"

function runtime(): CheckoutRuntimeResponse {
  return {
    popup: { id: "pop1", slug: "demo", name: "Demo", currency: "USD" },
    products: [
      {
        tenant_id: "t",
        popup_id: "pop1",
        id: "p1",
        name: "Ticket",
        slug: "ticket",
        price: "100",
        category: "ticket",
        is_active: true,
      },
    ],
    buyer_form: [],
    ticketing_steps: [
      { id: "s1", tenant_id: "t", popup_id: "pop1", step_type: "tickets", title: "Tickets" },
      { id: "s2", tenant_id: "t", popup_id: "pop1", step_type: "confirm", title: "Confirm" },
    ],
  }
}

/** A transport that returns canned bodies per path. */
function fakeTransport(): Transport {
  return {
    request: (async (_m: string, path: string) => {
      if (path.endsWith("/preview")) return { total: "200", currency: "USD" }
      return {}
    }) as Transport["request"],
  }
}

function wrapper(extra?: Partial<React.ComponentProps<typeof CheckoutProvider>>) {
  return ({ children }: { children: ReactNode }) => (
      <CheckoutProvider
        slug="demo"
        flowSlug="checkout"
      baseUrl="https://api/api/v1"
      transport={fakeTransport()}
      initialRuntime={runtime()}
      {...extra}
    >
      {children}
    </CheckoutProvider>
  )
}

describe("CheckoutProvider + hooks", () => {
  it("exposes derived steps once loaded", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.steps.length).toBeGreaterThan(0))
    expect(result.current.steps).toEqual(["passes", "confirm"])
    expect(result.current.currentStep).toBe("passes")
  })

  it("useCart mutations flow back into state", async () => {
    const { result } = renderHook(
      () => ({ cart: useCart(), checkout: useCheckout() }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.checkout.steps.length).toBeGreaterThan(0))

    act(() => result.current.cart.setQuantity("p1", 2))
    expect(result.current.cart.quantities).toEqual({ p1: 2 })
  })

  it("usePreview reflects the server total after a selection", async () => {
    const { result } = renderHook(
      () => ({ cart: useCart(), preview: usePreview() }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.cart.selection).toBeTruthy())

    act(() => result.current.cart.setQuantity("p1", 1))
    await waitFor(() => expect(result.current.preview.total).toBe("200"))
    expect(result.current.preview.status).toBe("success")
  })

  it("never exposes a disposed store, and preview stays live, under StrictMode", async () => {
    // StrictMode mounts→unmounts→mounts in dev, which disposes the internally
    // built store. The provider must rebuild it so the subtree always sees a
    // live store and preview keeps updating (the blank-total regression).
    const disposedSeen: boolean[] = []
    function Probe() {
      disposedSeen.push(useCheckoutStore().isDisposed())
      const cart = useCart()
      const preview = usePreview()
      return (
        <>
          <button type="button" onClick={() => cart.setQuantity("p1", 1)}>
            add
          </button>
          <output>{preview.total ?? "none"}</output>
        </>
      )
    }
    render(
      <StrictMode>
        <CheckoutProvider slug="demo" flowSlug="checkout" transport={fakeTransport()} initialRuntime={runtime()}>
          <Probe />
        </CheckoutProvider>
      </StrictMode>,
    )
    await waitFor(() => expect(screen.getByText("none")).toBeDefined())
    // The store handed to the subtree is never a disposed one.
    expect(disposedSeen.every((d) => d === false)).toBe(true)

    act(() => screen.getByText("add").click())
    await waitFor(() => expect(screen.getByText("200")).toBeDefined())
  })

  it("throws when a hook is used outside the provider", () => {
    // Silence the expected React error boundary log.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => renderHook(() => useCheckout())).toThrow(
      /must be used within a <CheckoutProvider>/,
    )
    spy.mockRestore()
  })

  it("renders children", () => {
    render(
      <CheckoutProvider slug="demo" flowSlug="checkout" transport={fakeTransport()} initialRuntime={runtime()} autoLoad={false}>
        <span>hello</span>
      </CheckoutProvider>,
    )
    expect(screen.getByText("hello")).toBeDefined()
  })
})
