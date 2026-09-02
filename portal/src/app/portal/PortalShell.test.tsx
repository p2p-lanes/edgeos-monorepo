import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

let pathname = "/portal/summit/shop"

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/components/Authentication", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/Providers", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/Sidebar/SidebarComponents", () => ({
  Sidebar: ({ children, className }: React.ComponentProps<"aside">) => (
    <aside data-testid="portal-sidebar" className={className}>
      {children}
    </aside>
  ),
  SidebarInset: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <section data-testid="portal-inset" className={className}>
      {children}
    </section>
  ),
  SidebarTrigger: () => <button type="button">Toggle sidebar</button>,
}))

vi.mock("@/components/common/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div>Language</div>,
}))

vi.mock("@/components/MobilePopupSwitcher", () => ({
  MobilePopupSwitcher: () => <div>Popup switcher</div>,
}))

vi.mock("@/components/Sidebar/CartBadge", () => ({
  default: () => <div>Cart</div>,
}))

vi.mock("@/components/Sidebar/PopupsMenu", () => ({ default: () => null }))
vi.mock("@/components/Sidebar/ResourcesMenu", () => ({ default: () => null }))
vi.mock("@/components/Sidebar/FooterMenu", () => ({ default: () => null }))

vi.mock("@/components/Sidebar/hooks/useBreadcrumbNameMapping", () => ({
  default: () => ({ nameMapping: {}, isLoading: false }),
}))

vi.mock("@/components/Sidebar/BreadcrumbSegment", () => ({
  default: () => <span>Shop</span>,
}))

vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ name: "Summit", slug: "summit" }),
  }),
}))

import PortalShell from "./PortalShell"

function expectPortalBoundary(getByTestId: (id: string) => HTMLElement) {
  expect(getByTestId("portal-sidebar").classList).toContain("portal-chrome")
  expect(getByTestId("portal-inset").classList).toContain("portal-chrome")
  expect(document.querySelector("#portal-scroll")?.classList).toContain(
    "portal-chrome",
  )
}

describe("PortalShell", () => {
  beforeEach(() => {
    pathname = "/portal/summit/shop"
    document.documentElement.style.setProperty("--background", "#111111")
    document.documentElement.style.setProperty("--foreground", "#f5f5f5")
  })

  it("keeps Portal chrome and canvas inside the fixed token boundary", () => {
    const { getByTestId } = render(
      <PortalShell>
        <div>Shop content</div>
      </PortalShell>,
    )

    expect(document.querySelector("header")?.classList).toContain(
      "portal-chrome",
    )
    expectPortalBoundary(getByTestId)
  })

  it("keeps the profile canvas scoped when the Portal header is absent", () => {
    pathname = "/portal/profile"

    const { getByTestId } = render(
      <PortalShell>
        <div>Profile content</div>
      </PortalShell>,
    )

    expect(document.querySelector("header")).toBeNull()
    expectPortalBoundary(getByTestId)
  })
})
