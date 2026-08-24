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
})
