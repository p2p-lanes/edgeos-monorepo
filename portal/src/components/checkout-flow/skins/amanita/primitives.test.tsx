/**
 * Smoke tests for the Amanita skin's shared presentational primitives
 * (Task 4): confirms GoldStar and SectionShell render without throwing and
 * that SectionShell forwards its children/title/kicker to the DOM. No
 * jest-dom in this project — assertions use `toBeTruthy()`/`getByText`.
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { GoldStar } from "./GoldStar"
import { SectionShell } from "./SectionShell"

describe("Amanita skin primitives", () => {
  it("renders GoldStar without throwing", () => {
    const { container } = render(<GoldStar />)
    expect(container.querySelector("span[aria-hidden]")).toBeTruthy()
  })

  it("renders SectionShell with kicker, title and children", () => {
    render(
      <SectionShell gem="bold" kicker="K" title="T">
        <div>child</div>
      </SectionShell>,
    )
    expect(screen.getByText("T")).toBeTruthy()
    expect(screen.getByText("K")).toBeTruthy()
    expect(screen.getByText("child")).toBeTruthy()
  })
})
