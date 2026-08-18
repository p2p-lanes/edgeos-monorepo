import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  GoogleFontsService: { listGoogleFonts: vi.fn() },
}))

import { GoogleFontsService } from "@/client"
import { GoogleFontPicker } from "./GoogleFontPicker"

const mockListFonts = vi.mocked(GoogleFontsService.listGoogleFonts)

function makeFonts(count: number, prefix = "Font", category = "sans-serif") {
  return Array.from({ length: count }, (_, index) => ({
    family: `${prefix} ${String(index + 1).padStart(4, "0")}`,
    category,
    variants: ["regular"],
    subsets: ["latin"],
  }))
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderPicker(fonts: ReturnType<typeof makeFonts>) {
  mockListFonts.mockResolvedValue({
    source: "google",
    fonts,
  } as Awaited<ReturnType<typeof GoogleFontsService.listGoogleFonts>>)

  render(<GoogleFontPicker value="" onChange={vi.fn()} aria-label="Font" />, {
    wrapper: makeWrapper(),
  })

  return userEvent.setup()
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Font" }))
  await screen.findByRole("listbox", { name: "Google Fonts" })
}

function getScroller() {
  const scroller = screen.getByRole("listbox", {
    name: "Google Fonts",
  }).parentElement
  if (!scroller) throw new Error("Font list scroll container was not rendered")
  return scroller
}

describe("GoogleFontPicker progressive disclosure", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("initially renders exactly 20 options from a 1,950-font catalog", async () => {
    const user = renderPicker(makeFonts(1950))

    await openPicker(user)

    expect(screen.getAllByRole("option")).toHaveLength(20)
    expect(screen.getByRole("option", { name: "Font 0001" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "Font 0021" })).toBeNull()
    expect(screen.getByRole("button", { name: "Show more" })).toBeVisible()
  })

  it("reveals one page at a time without moving the scroll position", async () => {
    const user = renderPicker(makeFonts(45))
    await openPicker(user)
    const scroller = getScroller()
    scroller.scrollTop = 96

    await user.click(screen.getByRole("button", { name: "Show more" }))

    expect(screen.getAllByRole("option")).toHaveLength(40)
    expect(scroller.scrollTop).toBe(96)
    await user.click(screen.getByRole("button", { name: "Show more" }))
    expect(screen.getAllByRole("option")).toHaveLength(45)
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull()
  })

  it("filters the full catalog and resets pagination and scroll", async () => {
    const fonts = [
      ...makeFonts(30, "Popular Sans", "sans-serif"),
      ...makeFonts(30, "Remote Serif", "serif"),
    ]
    const user = renderPicker(fonts)
    await openPicker(user)
    const scroller = getScroller()

    await user.click(screen.getByRole("button", { name: "Show more" }))
    scroller.scrollTop = 88
    await user.type(
      screen.getByPlaceholderText("Search Google Fonts…"),
      "Remote Serif",
    )

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20))
    expect(
      screen.getByRole("option", { name: "Remote Serif 0001" }),
    ).toBeVisible()
    expect(scroller.scrollTop).toBe(0)

    await user.clear(screen.getByPlaceholderText("Search Google Fonts…"))
    await user.click(screen.getByRole("button", { name: "Show more" }))
    scroller.scrollTop = 72
    await user.click(screen.getByRole("button", { name: "Serif" }))

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20))
    expect(
      screen.getByRole("option", { name: "Remote Serif 0001" }),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Serif" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(scroller.scrollTop).toBe(0)
  })
})
