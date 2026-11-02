import { render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; count?: number }) =>
      options?.count === undefined
        ? key
        : `${key}:${options.name}:${options.count}`,
  }),
}))

vi.mock("../SidebarComponents", () => ({
  SidebarMenuButton: ({
    isActive: _isActive,
    ...props
  }: ComponentProps<"button"> & { isActive?: boolean }) => (
    <button type="button" {...props} />
  ),
}))

import ResourceMenuItem from "./ResourceMenuItem"

const resource = {
  name: "Merch Items",
  status: "active" as const,
  path: "/portal/summit/shop/merch",
}

describe("ResourceMenuItem cart count", () => {
  it("shows the count and announces it", () => {
    render(
      <ResourceMenuItem
        resource={resource}
        color=""
        onNavigate={vi.fn()}
        cartCount={2}
      />,
    )

    const button = screen.getByRole("button", {
      name: "sidebar.cart_items_aria:Merch Items:2",
    })
    expect(within(button).getByText("2")).toBeTruthy()
  })

  it("stays out of the way when the cart is empty", () => {
    render(
      <ResourceMenuItem
        resource={resource}
        color=""
        onNavigate={vi.fn()}
        cartCount={0}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Merch Items" }).textContent,
    ).toBe("Merch Items")
  })
})
