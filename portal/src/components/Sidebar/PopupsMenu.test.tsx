import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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
    getCity: () => ({
      name: "Summit",
      slug: "summit",
      location: "Buenos Aires",
      start_date: "2026-10-12",
    }),
    getPopups: () => [
      { name: "Summit", slug: "summit", status: "active" },
      { name: "Valley", slug: "valley", status: "ended" },
    ],
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
