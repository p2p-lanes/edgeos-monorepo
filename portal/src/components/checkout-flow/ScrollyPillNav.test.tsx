import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ScrollyPillNav from "./ScrollyPillNav"

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    isStepComplete: () => false,
    visitedSteps: new Set<string>(),
    isBuyerInfoComplete: true,
    forcedBuyerFieldsTouched: new Set<string>(),
  }),
}))

const sections = [
  { id: "passes", label: "Tickets" },
  { id: "buyer", label: "Your Info" },
  { id: "confirm", label: "Confirm" },
]

describe("ScrollyPillNav", () => {
  it("renders one pill button per section with its label", () => {
    render(
      <ScrollyPillNav
        sections={sections}
        activeSection="passes"
        onSectionClick={() => {}}
      />,
    )
    expect(screen.getByText("Tickets")).toBeInTheDocument()
    expect(screen.getByText("Your Info")).toBeInTheDocument()
    expect(screen.getByText("Confirm")).toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(3)
  })

  it("marks the active section with aria-current=step", () => {
    render(
      <ScrollyPillNav
        sections={sections}
        activeSection="buyer"
        onSectionClick={() => {}}
      />,
    )
    const active = screen.getByText("Your Info").closest("button")
    expect(active).toHaveAttribute("aria-current", "step")
    const inactive = screen.getByText("Tickets").closest("button")
    expect(inactive).not.toHaveAttribute("aria-current")
  })

  it("calls onSectionClick with the section id when a pill is clicked", () => {
    const onClick = vi.fn()
    render(
      <ScrollyPillNav
        sections={sections}
        activeSection="passes"
        onSectionClick={onClick}
      />,
    )
    screen.getByText("Confirm").closest("button")?.click()
    expect(onClick).toHaveBeenCalledWith("confirm")
  })
})
