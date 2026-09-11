import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const SidebarComponents = await vi.importActual<
  typeof import("./SidebarComponents")
>("./SidebarComponents")

const resources = [
  {
    name: "Application",
    status: "active" as const,
    path: "/portal/summit",
    group: "commerce" as const,
  },
  {
    name: "Passes",
    status: "active" as const,
    path: "/portal/summit/passes",
    group: "commerce" as const,
  },
  {
    name: "Payments",
    status: "active" as const,
    path: "/portal/summit/orders",
    group: "commerce" as const,
  },
  {
    name: "Attendee",
    status: "active" as const,
    path: "/portal/summit/shop/attendee",
    group: "checkouts" as const,
  },
  {
    name: "Volunteer",
    status: "active" as const,
    path: "/portal/summit/shop/volunteer",
    group: "checkouts" as const,
  },
  {
    name: "Merch Store",
    status: "active" as const,
    path: "/portal/summit/shop/merch-store",
    group: "checkouts" as const,
  },
  {
    name: "Attendee Directory",
    status: "active" as const,
    path: "/portal/summit/attendees",
    group: "community" as const,
  },
]

let includeCheckoutResources = true

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/summit/shop/attendee",
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "sidebar.navigation": "Portal navigation",
        "sidebar.commerce": "Commerce",
        "sidebar.checkouts": "Checkouts",
        "sidebar.community": "Community",
        "sidebar.mobile_navigation": "Portal navigation menu",
      })[key] ?? key,
  }),
}))

vi.mock("@/hooks/useResources", () => ({
  default: () => ({
    resources: includeCheckoutResources
      ? resources
      : resources.filter((resource) => resource.group !== "checkouts"),
    doorName: null,
  }),
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
  beforeEach(() => {
    includeCheckoutResources = true
  })

  it("renders Commerce, translated Checkouts, and Community in order", () => {
    render(<ResourcesMenu />)

    expect(
      screen.getByRole("navigation", { name: "Portal navigation" }),
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Commerce" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Checkouts" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Community" })).toBeTruthy()
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["Commerce", "Checkouts", "Community"])
    expect(screen.queryByText("People")).toBeNull()
    expect(screen.queryByText("Shop")).toBeNull()
    expect(screen.queryByText("Orders")).toBeNull()
    expect(screen.getAllByText("Payments")).not.toHaveLength(0)
    expect(screen.getAllByText("Merch Store")).not.toHaveLength(0)
    const commerce = screen.getByRole("region", { name: "Commerce" })
    const checkouts = screen.getByRole("region", { name: "Checkouts" })
    expect(
      within(commerce)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Application", "Passes", "Payments"])
    expect(
      within(checkouts)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Attendee", "Volunteer", "Merch Store"])
    expect(
      screen.getByRole("link", { name: "Passes" }).getAttribute("href"),
    ).toBe("/portal/summit/passes")
    expect(
      screen
        .getByRole("link", { name: "Attendee" })
        .getAttribute("aria-current"),
    ).toBe("page")
    expect(
      screen.getByRole("link", { name: "Attendee" }).getAttribute("href"),
    ).toBe("/portal/summit/shop/attendee")
    expect(
      screen
        .getByRole("link", { name: "Volunteer" })
        .getAttribute("aria-current"),
    ).toBeNull()
  })

  it("does not render an empty Checkouts group", () => {
    includeCheckoutResources = false

    render(<ResourcesMenu />)

    expect(screen.queryByRole("heading", { name: "Checkouts" })).toBeNull()
    expect(screen.getByRole("heading", { name: "Commerce" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Community" })).toBeTruthy()
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
