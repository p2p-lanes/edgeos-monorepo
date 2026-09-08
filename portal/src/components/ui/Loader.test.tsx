import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Loader } from "./Loader"

describe("Loader scope", () => {
  it("keeps nested loading within content rather than covering portal navigation", () => {
    const navigate = vi.fn()
    const { container } = render(
      <>
        <aside>
          <button type="button" onClick={navigate}>
            Shop
          </button>
        </aside>
        <main>
          <Loader />
        </main>
      </>,
    )
    const loader = container.querySelector("main > div")
    expect(loader?.className).not.toMatch(/fixed|inset-0|z-50|bg-background/)
    fireEvent.click(screen.getByRole("button", { name: "Shop" }))
    expect(navigate).toHaveBeenCalledOnce()
  })
  it("allows explicit fullscreen bootstrap loading", () => {
    const { container } = render(<Loader fullscreen />)
    expect(container.firstElementChild?.className).toContain(
      "fixed inset-0 z-50",
    )
  })
})
