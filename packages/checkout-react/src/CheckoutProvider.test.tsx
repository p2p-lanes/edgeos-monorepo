import type { CheckoutProduct, Transport } from "@edgeos/checkout-core"
import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import { type ReactNode, StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { CheckoutProvider } from "./CheckoutProvider"
import { useCheckoutStore } from "./context"
import { useCart, useCheckout, usePreview } from "./hooks"

function products(): CheckoutProduct[] {
  return [
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
  ]
}

/** A transport that returns canned bodies per path. */
function fakeTransport(): Transport {
  return {
    request: (async (_m: string, path: string) => {
      if (path.endsWith("/primary")) return { flow_slug: "checkout" }
      if (path.endsWith("/preview")) return { total: "200", currency: "USD" }
      if (path.endsWith("/products")) return { products: products() }
      if (path.endsWith("/form")) return { form_schema: {} }
      return {}
    }) as Transport["request"],
  }
}

function wrapper(extra?: Partial<React.ComponentProps<typeof CheckoutProvider>>) {
  return ({ children }: { children: ReactNode }) => (
    <CheckoutProvider
      slug="demo"
      baseUrl="https://api/api/v1"
      transport={fakeTransport()}
      {...extra}
    >
      {children}
    </CheckoutProvider>
  )
}

describe("CheckoutProvider + hooks", () => {
  it("exposes the catalogue once loaded", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.products.map((p) => p.id)).toEqual(["p1"])
  })

  it("serves a seeded catalogue without fetching", async () => {
    const { result } = renderHook(() => useCheckout(), {
      wrapper: wrapper({ initialProducts: products(), initialFormSchema: null }),
    })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.products).toHaveLength(1)
  })

  it("useCart mutations flow back into state", async () => {
    const { result } = renderHook(
      () => ({ cart: useCart(), checkout: useCheckout() }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.checkout.loaded).toBe(true))

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
        <CheckoutProvider
          slug="demo"
          transport={fakeTransport()}
          initialProducts={products()}
          initialFormSchema={null}
        >
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
      <CheckoutProvider
        slug="demo"
        transport={fakeTransport()}
        initialProducts={products()}
        initialFormSchema={null}
        autoLoad={false}
      >
        <span>hello</span>
      </CheckoutProvider>,
    )
    expect(screen.getByText("hello")).toBeDefined()
  })
})
