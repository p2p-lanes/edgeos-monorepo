import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const providerState = vi.hoisted(() => ({
  city: {
    name: "Summit",
    slug: "summit",
    location: "Buenos Aires",
    start_date: "2026-10-12",
  } as {
    name: string
    slug: string
    location: string
    start_date: string
  } | null,
  popups: [
    { name: "Summit", slug: "summit", status: "active" },
    { name: "Valley", slug: "valley", status: "ended" },
  ],
  popupsLoaded: true,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "recap.status_badge": "Ended",
        "sidebar.mobile_navigation": "Portal navigation menu",
      })[key] ?? key,
  }),
}))

vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => providerState.city,
    getPopups: () => providerState.popups,
    popupsLoaded: providerState.popupsLoaded,
  }),
}))

vi.mock("./DropdownMenu", () => ({
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    selected: _selected,
    ...props
  }: React.ComponentProps<"button"> & { selected?: boolean }) => (
    <button type="button" role="menuitem" {...props}>
      {children}
    </button>
  ),
}))

import PopupsMenu from "./PopupsMenu"
import { SidebarProvider } from "./SidebarComponents"

describe("PopupsMenu", () => {
  beforeEach(() => {
    providerState.city = {
      name: "Summit",
      slug: "summit",
      location: "Buenos Aires",
      start_date: "2026-10-12",
    }
    providerState.popups = [
      { name: "Summit", slug: "summit", status: "active" },
      { name: "Valley", slug: "valley", status: "ended" },
    ]
    providerState.popupsLoaded = true
  })

  it("does not render a popup selector after an empty list has loaded", () => {
    providerState.city = null
    providerState.popups = []

    const { container } = render(
      <SidebarProvider>
        <PopupsMenu />
      </SidebarProvider>,
    )

    expect(container.querySelector('[data-sidebar="menu-button"]')).toBeNull()
  })

  it("keeps the popup skeleton while the list is loading", () => {
    providerState.city = null
    providerState.popups = []
    providerState.popupsLoaded = false

    const { container } = render(
      <SidebarProvider>
        <PopupsMenu />
      </SidebarProvider>,
    )

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(
      container.querySelector('[data-sidebar="menu-button"]'),
    ).not.toBeNull()
  })

  it("keeps the selected popup identifiable in the Portal sidebar menu", () => {
    render(
      <SidebarProvider>
        <PopupsMenu />
      </SidebarProvider>,
    )

    expect(screen.getByText("Buenos Aires")).toBeTruthy()

    expect(
      screen
        .getByRole("menuitem", { name: "Summit" })
        .getAttribute("aria-current"),
    ).toBe("page")
  })

  it("does not mark another popup as the current Portal context", () => {
    render(
      <SidebarProvider>
        <PopupsMenu />
      </SidebarProvider>,
    )

    expect(
      screen
        .getByRole("menuitem", { name: /valley/i })
        .getAttribute("aria-current"),
    ).toBeNull()
    expect(screen.getByText("Ended")).toBeTruthy()
  })
})
