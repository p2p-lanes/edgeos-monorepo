import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import SectionHeader from "./SectionHeader"

describe("SectionHeader", () => {
  it("prevents configured titles from forming icon-font ligatures", () => {
    render(<SectionHeader title="Meals Plan" variant="snap" />)

    const title = screen.getByRole("heading", { name: "Meals Plan" })

    expect(title.querySelectorAll("span")).toHaveLength("Meals Plan".length)
    expect(title.textContent).toBe("Meals\u00A0Plan")
  })

  it("renders the configured title and watermark exactly once each", () => {
    const { container } = render(
      <SectionHeader title="Meals Plan" watermark="Tickets" variant="snap" />,
    )

    expect(screen.getAllByRole("heading", { name: "Meals Plan" })).toHaveLength(
      1,
    )
    const watermarks = container.querySelectorAll('p[aria-hidden="true"]')
    expect(watermarks).toHaveLength(1)
    expect(watermarks[0].textContent).toBe("Tickets")
  })
})
