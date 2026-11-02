import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type CartLine, EMPTY_CART } from "@/hooks/useCartApi"
import type { FlowCart } from "@/hooks/useFlowCarts"
import { summarizeCart } from "@/lib/cart-summary"

const mocks = vi.hoisted(() => ({
  flowCarts: [] as FlowCart[],
  clearCart: vi.fn(),
  useClearCart: vi.fn(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string
    children: ReactNode
    onClick?: () => void
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        onClick?.()
      }}
    >
      {children}
    </a>
  ),
}))

vi.mock("@/hooks/useFlowCarts", () => ({
  useFlowCarts: () => mocks.flowCarts,
}))

vi.mock("@/hooks/useCartApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCartApi")>()),
  useClearCart: mocks.useClearCart,
}))

import CartBadge from "./CartBadge"

const flowCart = (
  flowId: string,
  name: string,
  slug: string,
  lines: CartLine[],
): FlowCart => {
  const summary = summarizeCart({ ...EMPTY_CART, lines })
  return {
    popupId: "popup-1",
    flowId,
    name,
    path: `/portal/summit/shop/${slug}`,
    summary,
    itemCount: summary.itemCount,
  }
}

const product = (step_type: string, quantity = 1): CartLine => ({
  kind: "product",
  product_id: `${step_type}-product`,
  quantity,
  price: null,
  step_type,
  assignment: { kind: "unassigned" },
})

const openCart = () =>
  fireEvent.click(screen.getByRole("button", { name: "cartBadge.aria_open" }))

describe("CartBadge", () => {
  beforeEach(() => {
    mocks.flowCarts = []
    mocks.clearCart.mockReset()
    mocks.useClearCart.mockReset()
    mocks.useClearCart.mockReturnValue({
      mutate: mocks.clearCart,
      isPending: false,
    })
  })

  it("renders nothing while no flow has anything in its cart", () => {
    mocks.flowCarts = [flowCart("tickets-1", "Event Tickets", "tickets", [])]

    const { container } = render(<CartBadge />)

    expect(container.firstChild).toBeNull()
  })

  it("links to the checkout of the flow holding the cart, not the home", () => {
    mocks.flowCarts = [
      flowCart("tickets-1", "Event Tickets", "tickets", []),
      flowCart("merch-1", "Merch Items", "merch", [product("merch")]),
    ]

    render(<CartBadge />)
    openCart()

    expect(
      screen
        .getByRole("link", { name: "cartBadge.go_to_checkout" })
        .getAttribute("href"),
    ).toBe("/portal/summit/shop/merch")
    // Naming the only flow involved would add nothing.
    expect(screen.queryByText("Merch Items")).toBeNull()
  })

  it("closes once the buyer follows the link, even to the page already open", () => {
    mocks.flowCarts = [
      flowCart("tickets-1", "Event Tickets", "tickets", [product("tickets")]),
    ]

    render(<CartBadge />)
    openCart()
    fireEvent.click(
      screen.getByRole("link", { name: "cartBadge.go_to_checkout" }),
    )

    expect(
      screen.queryByRole("link", { name: "cartBadge.go_to_checkout" }),
    ).toBeNull()
  })

  it("adds up every flow and gives each its own checkout link and clear", () => {
    mocks.flowCarts = [
      flowCart("tickets-1", "Event Tickets", "tickets", [
        product("tickets", 2),
      ]),
      flowCart("merch-1", "Merch Items", "merch", [product("merch")]),
    ]

    render(<CartBadge />)

    expect(
      within(
        screen.getByRole("button", { name: "cartBadge.aria_open" }),
      ).getByText("3"),
    ).toBeTruthy()

    openCart()

    const tickets = screen
      .getByRole("heading", { name: "Event Tickets" })
      .closest("section") as HTMLElement
    const merch = screen
      .getByRole("heading", { name: "Merch Items" })
      .closest("section") as HTMLElement
    expect(within(tickets).getByRole("link").getAttribute("href")).toBe(
      "/portal/summit/shop/tickets",
    )
    expect(within(tickets).getByText("cartBadge.passes:2")).toBeTruthy()
    expect(within(merch).getByRole("link").getAttribute("href")).toBe(
      "/portal/summit/shop/merch",
    )
    expect(within(merch).getByText("cartBadge.merch:1")).toBeTruthy()
    expect(mocks.useClearCart).toHaveBeenCalledWith("popup-1", "tickets-1")
    expect(mocks.useClearCart).toHaveBeenCalledWith("popup-1", "merch-1")
  })

  it("asks for confirmation before clearing a cart", () => {
    mocks.flowCarts = [
      flowCart("tickets-1", "Event Tickets", "tickets", [product("tickets")]),
    ]

    render(<CartBadge />)
    openCart()
    fireEvent.click(screen.getByRole("button", { name: "cartBadge.clear" }))
    expect(mocks.clearCart).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", { name: "cartBadge.clear_confirm" }),
    )
    expect(mocks.clearCart).toHaveBeenCalledTimes(1)
  })

  it("describes lines from steps that have no label of their own", () => {
    mocks.flowCarts = [
      flowCart("lunch-1", "Lunch Tickets", "lunch", [product("lunch", 2)]),
    ]

    render(<CartBadge />)
    openCart()

    expect(screen.getByText("cartBadge.items:2")).toBeTruthy()
  })
})
