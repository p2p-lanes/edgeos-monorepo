import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

let pathname = "/portal/summit/shop/attendee"

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "sidebar.commerce": "Commerce",
        "breadcrumbs.passes": "Passes",
        "breadcrumbs.buy": "Buy",
      })[key] ?? key,
  }),
}))

vi.mock("@/components/common/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}))

vi.mock("@/components/MobilePopupSwitcher", () => ({
  MobilePopupSwitcher: () => null,
}))

vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => true }))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", name: "Summit", slug: "summit" }),
  }),
}))

vi.mock("./CartBadge", () => ({ default: () => null }))
vi.mock("./hooks/useBreadcrumbNameMapping", () => ({
  default: () => ({ nameMapping: {}, isLoading: false }),
}))
vi.mock("./SidebarComponents", () => ({ SidebarTrigger: () => null }))

import HeaderBar from "./HeaderBar"

describe("HeaderBar breadcrumbs", () => {
  beforeEach(() => {
    pathname = "/portal/summit/shop/attendee"
  })

  it("renders Commerce without a link when its aggregate route is absent", () => {
    const { container } = render(<HeaderBar />)

    expect(screen.queryByRole("link", { name: "Commerce" })).toBeNull()
    expect(screen.getByText("Commerce").getAttribute("aria-current")).toBeNull()
    expect(container.querySelector('a[href="/portal/summit/shop"]')).toBeNull()
    const currentPages = container.querySelectorAll('[aria-current="page"]')
    expect(currentPages).toHaveLength(1)
    expect(currentPages[0]?.textContent).toBe("Attendee")
  })

  it("keeps breadcrumbs linked when their aggregate route exists", () => {
    pathname = "/portal/summit/passes/buy"

    render(<HeaderBar />)

    expect(
      screen.getByRole("link", { name: "Passes" }).getAttribute("href"),
    ).toBe("/portal/summit/passes")
  })
})
