import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PopupPublic } from "@/client"
import { CheckoutShell } from "./CheckoutShell"

vi.mock("@/components/Sidebar/SidebarComponents", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("framer-motion", () => ({
  useReducedMotion: () => true,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => vi.restoreAllMocks())

function popupWithBackground(url?: string): PopupPublic {
  return {
    express_checkout_background: url,
    theme_config: url
      ? { checkout_background_contexts: ["checkout"] }
      : undefined,
  } as unknown as PopupPublic
}

function renderInPortal(popup: PopupPublic) {
  render(
    <div className="portal-chrome" data-testid="portal-ancestor">
      <CheckoutShell popup={popup}>
        <div data-testid="checkout-content" className="min-h-[200vh]" />
      </CheckoutShell>
    </div>,
  )

  return screen.getByRole("main")
}

function expectIsolatedCanvas(main: HTMLElement) {
  expect(main.closest(".portal-chrome")).toBeTruthy()
  expect(main.classList).toContain("relative")
  expect(main.classList).toContain("isolate")
  expect(main.classList).toContain("bg-background")
  expect(main.classList).toContain("h-svh")
  expect(main.classList).toContain("overflow-y-auto")
  const canvas = screen.getByTestId("checkout-content").parentElement
  expect(canvas?.classList).toContain("relative")
  expect(canvas?.classList).toContain("min-h-full")
  expect(canvas?.parentElement).toBe(main)
}

describe("CheckoutShell", () => {
  it("owns an isolated themed canvas without media under Portal chrome", () => {
    const main = renderInPortal(popupWithBackground())

    expectIsolatedCanvas(main)
    expect(main.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(main.querySelector("video")).toBeNull()
  })

  it("keeps image media non-interactive and geometrically contained by the checkout canvas", () => {
    const main = renderInPortal(
      popupWithBackground("https://example.com/dark.jpg"),
    )
    const media = main.querySelector('[aria-hidden="true"]') as HTMLElement
    const canvas = screen.getByTestId("checkout-content").parentElement

    expectIsolatedCanvas(main)
    expect(media.parentElement).toBe(canvas)
    expect(media.classList).toContain("absolute")
    expect(media.classList).not.toContain("fixed")
    expect(media.classList).toContain("-z-10")
    expect(media.classList).toContain("pointer-events-none")
  })

  it("contains non-interactive video media while preserving interactive playback controls", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
    const main = renderInPortal(
      popupWithBackground("https://example.com/dark.mp4"),
    )
    const media = main.querySelector("video") as HTMLVideoElement
    const canvas = screen.getByTestId("checkout-content").parentElement
    const playControl = screen.getByRole("button", {
      name: "checkout.video.play_aria",
    })

    expectIsolatedCanvas(main)
    expect(media.parentElement).toBe(canvas)
    expect(media.classList).toContain("absolute")
    expect(media.classList).not.toContain("fixed")
    expect(media.classList).toContain("-z-10")
    expect(media.classList).toContain("pointer-events-none")
    expect(playControl.classList).toContain("pointer-events-auto")
    expect(playControl.parentElement?.classList).toContain("fixed")
  })
})
