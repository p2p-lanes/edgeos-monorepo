import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router")
  return {
    ...actual,
    createFileRoute: () => () => ({}),
  }
})

import { TicketingStepsHeader } from "@/routes/_layout/ticketing-steps"

describe("TicketingStepsHeader", () => {
  it("keeps preview in the header and renders flow scope as a separate row", () => {
    const { container } = render(
      <TicketingStepsHeader
        onPreview={vi.fn()}
        scopeBar={<div data-testid="flow-scope">Flow scope</div>}
      />,
    )

    const title = screen.getByRole("heading", { name: "Ticketing Steps" })
    const preview = screen.getByRole("button", { name: "Preview checkout" })
    const scope = screen.getByTestId("flow-scope")
    const headerRow = preview.parentElement

    expect(headerRow).toContainElement(title)
    expect(headerRow).not.toContainElement(scope)
    expect(scope.parentElement).toBe(container)
  })
})
