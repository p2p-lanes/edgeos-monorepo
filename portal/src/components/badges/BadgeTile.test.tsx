import "@/i18n/config"

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BadgeTile } from "./BadgeTile"

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: ComponentProps<"img"> & { fill?: boolean; unoptimized?: boolean }) => (
    // biome-ignore lint/performance/noImgElement: Test double for next/image.
    <img alt={alt} {...props} />
  ),
}))

afterEach(cleanup)

const message =
  "Thanks for helping new builders find their next step. Your thoughtful feedback helped us turn an idea into a working prototype and made everyone feel welcome."

function renderRecognition() {
  return render(
    <BadgeTile
      name="Mentoring"
      category="Community"
      imageUrl="https://cdn.edgeos.world/mentoring.webp"
      description="Support for new builders."
      awards={[
        {
          message,
          issuer_name: "Alex Rivera",
          awarded_at: "2026-10-08T12:00:00Z",
        },
      ]}
    />,
  )
}

describe("BadgeTile", () => {
  it("keeps only artwork, category and name on the collectible card", () => {
    renderRecognition()

    const card = screen.getByRole("button", { name: "Mentoring" })
    expect(within(card).getByRole("img", { name: "Mentoring" })).toBeTruthy()
    expect(within(card).getByText("Community")).toBeTruthy()
    expect(card.getAttribute("aria-haspopup")).toBe("dialog")
    expect(screen.queryByText(message)).toBeNull()
    expect(screen.queryByText("Support for new builders.")).toBeNull()
    expect(screen.queryByText("×1")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens the full description and recognition without clipping the message", () => {
    renderRecognition()
    fireEvent.click(screen.getByRole("button", { name: "Mentoring" }))

    const dialog = within(screen.getByRole("dialog", { name: "Mentoring" }))
    expect(dialog.getByText("Support for new builders.")).toBeTruthy()
    expect(dialog.getByText("Alex Rivera")).toBeTruthy()
    expect(dialog.getByText(message).className).not.toContain("line-clamp")
    expect(dialog.getByText("Oct 8, 2026").getAttribute("datetime")).toBe(
      "2026-10-08T12:00:00Z",
    )
    expect(dialog.getByRole("img", { name: "Mentoring" })).toBeTruthy()
  })

  it("shows the quantity and every recognition for repeated awards", () => {
    render(
      <BadgeTile
        name="Workshop"
        count={3}
        awards={[
          { awarded_at: "2026-10-08T12:00:00Z", message: "First workshop" },
          { awarded_at: "2026-10-09T12:00:00Z", message: "Second workshop" },
          { awarded_at: "2026-10-10T12:00:00Z", message: "Third workshop" },
        ]}
      />,
    )

    expect(screen.getByText("×3")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Workshop" }))
    const dialog = within(screen.getByRole("dialog", { name: "Workshop" }))
    expect(dialog.getByText("Received 3 times")).toBeTruthy()
    expect(dialog.getByText("First workshop")).toBeTruthy()
    expect(dialog.getByText("Second workshop")).toBeTruthy()
    expect(dialog.getByText("Third workshop")).toBeTruthy()
  })

  it("supports missing artwork and metadata in both the card and detail", () => {
    render(<BadgeTile name="Coworking" imageUrl={null} category={null} />)

    const card = screen.getByRole("button", { name: "Coworking" })
    expect(screen.queryByRole("img")).toBeNull()
    expect(card.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    fireEvent.click(card)
    const dialog = screen.getByRole("dialog", { name: "Coworking" })
    expect(dialog.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    )
    expect(within(dialog).queryByText("Recognition")).toBeNull()
  })

  it("closes on Escape and returns keyboard focus to the card", async () => {
    renderRecognition()
    const card = screen.getByRole("button", { name: "Mentoring" })
    card.focus()
    fireEvent.click(card)
    const dialog = screen.getByRole("dialog", { name: "Mentoring" })
    fireEvent.keyDown(dialog, { key: "Escape" })

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(document.activeElement).toBe(card)
    })
  })

  it("supports public descriptions without showing private recognition history", () => {
    render(
      <BadgeTile name="Hiking" description="Shared adventures on the trail." />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Hiking" }))
    const dialog = within(screen.getByRole("dialog", { name: "Hiking" }))
    expect(dialog.getByText("Shared adventures on the trail.")).toBeTruthy()
    expect(dialog.queryByText("Recognition")).toBeNull()
    fireEvent.click(dialog.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
