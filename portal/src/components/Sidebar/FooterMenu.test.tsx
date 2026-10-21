import { fireEvent, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({ "profile.my_profile": "My profile" })[key] ?? key,
  }),
}))

vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => true }))

import FooterMenu from "./FooterMenu"
import { SidebarProvider, useSidebar } from "./SidebarComponents"

// Opens the mobile sheet on mount and exposes its state for assertions.
const MobileSheetProbe = () => {
  const { openMobile, setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(true)
  }, [setOpenMobile])

  return <output data-testid="open-mobile">{String(openMobile)}</output>
}

describe("FooterMenu", () => {
  beforeEach(() => {
    push.mockClear()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("closes the mobile sheet when opening the profile", () => {
    render(
      <SidebarProvider>
        <MobileSheetProbe />
        <FooterMenu />
      </SidebarProvider>,
    )
    expect(screen.getByTestId("open-mobile").textContent).toBe("true")

    fireEvent.click(screen.getByRole("button", { name: "My profile" }))

    expect(screen.getByTestId("open-mobile").textContent).toBe("false")
    expect(push).toHaveBeenCalledWith("/portal/profile")
  })
})
