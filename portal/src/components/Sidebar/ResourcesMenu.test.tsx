import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const SidebarComponents = await vi.importActual<
  typeof import("./SidebarComponents")
>("./SidebarComponents")

const resources = [
  {
    name: "Home",
    status: "active" as const,
    path: "/portal/summit",
    group: "commerce" as const,
  },
  {
    name: "Application",
    status: "active" as const,
    path: "/portal/summit/overview",
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
  {
    name: "Events",
    status: "active" as const,
    path: "/portal/summit/events",
    group: "community" as const,
    children: [
      {
        name: "Tracks",
        status: "active" as const,
        path: "/portal/summit/events/tracks",
      },
      {
        name: "Venues",
        status: "active" as const,
        path: "/portal/summit/events/venues",
      },
    ],
  },
]

let includeCheckoutResources = true
let configuredSidebar: {
  layout?: (
    | {
        id: string
        type: "section"
        title: string
        items: string[]
        links?: { id: string; label: string; url: string }[]
      }
    | { id: string; type: "item"; resource: string }
  )[]
  hidden_items?: string[]
} | null = null

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/summit/shop/attendee",
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "sidebar.navigation": "Portal navigation",
        "sidebar.home": "Home",
        "sidebar.application": "Application",
        "sidebar.overview": "Overview",
        "sidebar.passes": "Passes",
        "sidebar.orders": "Payments",
        "sidebar.events": "Events",
        "sidebar.attendee_directory": "Attendee Directory",
        "sidebar.referrals": "Referrals",
        "sidebar.commerce": "General",
        "sidebar.general": "General",
        "sidebar.checkouts": "Commerce",
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

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ sidebar_config: configuredSidebar }),
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

vi.mock("../ui/separator", () => ({
  Separator: () => <hr data-testid="nav-separator" />,
}))

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
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
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
    configuredSidebar = null
  })

  it("renders General, Commerce, and Community in order", () => {
    render(<ResourcesMenu />)

    expect(
      screen.getByRole("navigation", { name: "Portal navigation" }),
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Commerce" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Community" })).toBeTruthy()
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["General", "Commerce", "Community"])
    expect(screen.queryByText("People")).toBeNull()
    expect(screen.queryByText("Shop")).toBeNull()
    expect(screen.queryByText("Orders")).toBeNull()
    expect(screen.getAllByText("Payments")).not.toHaveLength(0)
    expect(screen.getAllByText("Merch Store")).not.toHaveLength(0)
    const commerce = screen.getByRole("region", { name: "General" })
    const checkouts = screen.getByRole("region", { name: "Commerce" })
    expect(
      within(commerce)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Application", "Passes", "Payments"])
    expect(
      within(checkouts)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Attendee", "Volunteer", "Merch Store"])
    expect(
      screen.getByRole("link", { name: "Home" }).getAttribute("href"),
    ).toBe("/portal/summit")
    expect(
      screen.getByRole("link", { name: "Application" }).getAttribute("href"),
    ).toBe("/portal/summit/overview")
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

  it("does not render an empty Commerce group", () => {
    includeCheckoutResources = false

    render(<ResourcesMenu />)

    expect(screen.queryByRole("heading", { name: "Commerce" })).toBeNull()
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Community" })).toBeTruthy()
  })

  it("reorders existing sections and renders an external-link section", () => {
    configuredSidebar = {
      layout: [
        {
          id: "commerce-options",
          type: "section",
          title: "Commerce options",
          items: ["checkouts"],
          links: [],
        },
        {
          id: "general-details",
          type: "section",
          title: "Gathering details",
          items: ["home", "application", "passes", "orders"],
          links: [],
        },
        {
          id: "external",
          type: "section",
          title: "Venue links",
          items: [],
          links: [
            {
              id: "external",
              label: "Venue website",
              url: "https://example.com",
            },
          ],
        },
        {
          id: "community",
          type: "section",
          title: "Community",
          items: ["directory", "events", "referrals", "groups"],
          links: [],
        },
      ],
    }

    render(<ResourcesMenu />)

    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual([
      "Commerce options",
      "Gathering details",
      "Venue links",
      "Community",
    ])
    const section = screen.getByRole("region", { name: "Gathering details" })
    expect(
      within(section)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Application", "Passes", "Payments"])
    expect(
      screen
        .getByRole("link", { name: "Venue website" })
        .getAttribute("target"),
    ).toBe("_blank")
    const navigation = screen.getByRole("navigation", {
      name: "Portal navigation",
    })
    expect(navigation.lastElementChild?.getAttribute("data-testid")).toBe(
      "nav-separator",
    )
  })

  it("places Home outside sections and hides selected community options", () => {
    configuredSidebar = {
      layout: [
        { id: "standalone-home", type: "item", resource: "home" },
        {
          id: "community",
          type: "section",
          title: "Community",
          items: ["directory", "events", "referrals", "groups"],
          links: [],
        },
        {
          id: "commerce",
          type: "section",
          title: "Commerce",
          items: ["checkouts"],
          links: [],
        },
        {
          id: "general",
          type: "section",
          title: "General",
          items: ["application", "passes", "orders"],
          links: [],
        },
      ],
      hidden_items: ["tracks"],
    }

    render(<ResourcesMenu />)

    const links = screen.getAllByRole("link")
    expect(links[0].textContent).toBe("Home")
    expect(screen.queryByRole("link", { name: "Tracks" })).toBeNull()
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["Community", "Commerce", "General"])
    expect(
      screen
        .getByRole("link", { name: "Home" })
        .closest("section")
        ?.getAttribute("aria-labelledby"),
    ).toBeNull()
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
