import { fireEvent, render, screen } from "@testing-library/react"
import { LayoutList } from "lucide-react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import { Main } from "./Main"

const close = vi.hoisted(() => vi.fn())
vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({ location: { pathname: "/" } }),
  Link: ({ to, onClick, ...props }: ComponentProps<"a"> & { to: string }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    />
  ),
}))
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: true, setOpenMobile: close }),
  SidebarGroup: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  SidebarGroupContent: ({ children }: ComponentProps<"div">) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: ComponentProps<"div">) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({ children }: ComponentProps<"div">) => children,
  SidebarMenuBadge: () => null,
}))

describe("sidebar navigation intent", () => {
  it("prefetches on pointer/focus while preserving normal navigation and mobile closing", () => {
    const intent = vi.fn()
    render(
      <Main
        items={[
          {
            icon: LayoutList,
            title: "Ticketing Steps",
            path: "/ticketing-steps",
          },
        ]}
        onIntent={intent}
      />,
    )
    const link = screen.getByRole("link", { name: "Ticketing Steps" })
    expect(intent).not.toHaveBeenCalled()
    fireEvent.pointerEnter(link)
    fireEvent.focus(link)
    expect(intent).toHaveBeenNthCalledWith(1, "/ticketing-steps")
    expect(intent).toHaveBeenNthCalledWith(2, "/ticketing-steps")
    fireEvent.click(link)
    expect(close).toHaveBeenCalledWith(false)
    expect(link).toHaveAttribute("href", "/ticketing-steps")
  })
})
