import { render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { describe, expect, it, vi } from "vitest"

const SidebarComponents = await vi.importActual<
  typeof import("./SidebarComponents")
>("./SidebarComponents")

const resources = [
  {
    name: "Application",
    status: "active" as const,
    path: "/portal/summit",
    group: "general" as const,
  },
  {
    name: "People",
    status: "active" as const,
    path: "/portal/summit/people",
    group: "participation" as const,
  },
  {
    name: "Tickets & Access",
    status: "active" as const,
    path: "/portal/summit/tickets",
    group: "participation" as const,
  },
  {
    name: "Shop",
    status: "active" as const,
    path: "/portal/summit/shop",
    group: "commerce" as const,
  },
  {
    name: "Orders",
    status: "active" as const,
    path: "/portal/summit/orders",
    group: "commerce" as const,
  },
  {
    name: "Attendee Directory",
    status: "active" as const,
    path: "/portal/summit/attendees",
    group: "community" as const,
  },
]

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/summit/shop",
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "sidebar.navigation": "Portal navigation",
        "sidebar.general": "General",
        "sidebar.participation": "Participation",
        "sidebar.commerce": "Commerce",
        "sidebar.community": "Community",
        "sidebar.mobile_navigation": "Portal navigation menu",
      })[key] ?? key,
  }),
}))

vi.mock("@/hooks/useResources", () => ({
  default: () => ({ resources, doorName: null }),
}))

let isMobile = true

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => isMobile,
}))

vi.mock("./Groups/GroupsResources", () => ({ default: () => null }))

vi.mock("./StatusResource/ResourceMenuItem", () => ({
  default: ({
    resource,
    isActive,
  }: {
    resource: { name: string; path: string }
    isActive: boolean
  }) => (
    <a aria-current={isActive ? "page" : undefined} href={resource.path}>
      {resource.name}
    </a>
  ),
}))

vi.mock("../ui/separator", () => ({ Separator: () => null }))

vi.mock("../ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock("./SidebarComponents", () => ({
  SidebarContent: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  SidebarGroup: ({ children, ...props }: React.ComponentProps<"section">) => (
    <section {...props}>{children}</section>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => children,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuSub: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

import ResourcesMenu from "./ResourcesMenu"

describe("ResourcesMenu", () => {
  it("groups separate navigation responsibilities by user intent", () => {
    render(<ResourcesMenu />)

    expect(
      screen.getByRole("navigation", { name: "Portal navigation" }),
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Participation" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Commerce" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Community" })).toBeTruthy()
    expect(screen.getAllByText("People")).not.toHaveLength(0)
    expect(screen.getAllByText("Tickets & Access")).not.toHaveLength(0)
    expect(screen.getAllByText("Shop")).not.toHaveLength(0)
    expect(screen.getAllByText("Orders")).not.toHaveLength(0)
    expect(screen.getByRole("region", { name: "Commerce" })).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Shop" }).getAttribute("aria-current"),
    ).toBe("page")
  })

  it("uses the localized name for the mobile navigation sheet", () => {
    isMobile = true
    const { Sidebar, SidebarProvider, useSidebar } = SidebarComponents

    const OpenMobileSidebar = () => {
      const { setOpenMobile } = useSidebar()

      useEffect(() => {
        setOpenMobile(true)
      }, [setOpenMobile])

      return (
        <Sidebar>
          <span>Portal content</span>
        </Sidebar>
      )
    }

    render(
      <SidebarProvider>
        <OpenMobileSidebar />
      </SidebarProvider>,
    )

    expect(screen.getByText("Portal navigation menu")).toBeTruthy()
    expect(screen.getByRole("dialog").className).toContain("portal-chrome")
  })

  it("scopes the desktop wrapper before sidebar foreground is computed", () => {
    isMobile = false
    const { Sidebar, SidebarProvider } = SidebarComponents

    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <span>Portal content</span>
        </Sidebar>
      </SidebarProvider>,
    )

    expect(container.querySelector("[data-state]")?.className).toContain(
      "portal-chrome text-sidebar-foreground",
    )
  })
})
