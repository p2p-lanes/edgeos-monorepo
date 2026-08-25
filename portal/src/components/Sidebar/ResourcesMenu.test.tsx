import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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
      })[key] ?? key,
  }),
}))

vi.mock("@/hooks/useResources", () => ({
  default: () => ({ resources, doorName: null }),
}))

vi.mock("./Groups/GroupsResources", () => ({ default: () => null }))

vi.mock("./StatusResource/ResourceMenuItem", () => ({
  default: ({ resource }: { resource: { name: string } }) => (
    <span>{resource.name}</span>
  ),
}))

vi.mock("../ui/separator", () => ({ Separator: () => null }))

vi.mock("../ui/tooltip", () => ({
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
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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
  })
})
