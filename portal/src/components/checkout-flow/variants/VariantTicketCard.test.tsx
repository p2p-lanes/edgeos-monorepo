import { describe, expect, it } from "vitest"
import { parseVariant } from "./VariantTicketCard"

describe("parseVariant", () => {
  it("returns showcase when configured", () => {
    expect(parseVariant({ variant: "showcase" })).toBe("showcase")
  })

  it("passes through tabs and compact", () => {
    expect(parseVariant({ variant: "tabs" })).toBe("tabs")
    expect(parseVariant({ variant: "compact" })).toBe("compact")
  })

  it("falls back to stacked for unknown or missing", () => {
    expect(parseVariant({ variant: "bogus" })).toBe("stacked")
    expect(parseVariant({})).toBe("stacked")
    expect(parseVariant(null)).toBe("stacked")
    expect(parseVariant(undefined)).toBe("stacked")
  })
})

import { fireEvent, render, screen } from "@testing-library/react"
import { ShowcaseStepper } from "./VariantTicketCard"

describe("ShowcaseStepper", () => {
  const handlers = { onAdd: () => {}, onIncrement: () => {}, onDecrement: () => {} }

  it("renders a single add button at quantity 0", () => {
    render(
      <ShowcaseStepper quantity={0} max={5} disabled={false} label="GA" {...handlers} />,
    )
    const btns = screen.getAllByRole("button")
    expect(btns).toHaveLength(1)
    expect(btns[0].textContent).toBe("+")
  })

  it("renders the − n + pill at quantity >= 1", () => {
    render(
      <ShowcaseStepper quantity={2} max={5} disabled={false} label="GA" {...handlers} />,
    )
    expect(screen.getAllByRole("button")).toHaveLength(2)
    expect(screen.getByText("2")).toBeTruthy()
  })

  it("disables increment at max", () => {
    let inc = 0
    render(
      <ShowcaseStepper
        quantity={5}
        max={5}
        disabled={false}
        label="GA"
        onAdd={() => {}}
        onIncrement={() => { inc += 1 }}
        onDecrement={() => {}}
      />,
    )
    // The + button is the last of the two pill buttons
    const plus = screen.getAllByRole("button")[1]
    fireEvent.click(plus)
    expect(inc).toBe(0)
  })

  it("disables both pill buttons when disabled", () => {
    let dec = 0
    let inc = 0
    render(
      <ShowcaseStepper
        quantity={2}
        max={5}
        disabled={true}
        label="GA"
        onAdd={() => {}}
        onIncrement={() => { inc += 1 }}
        onDecrement={() => { dec += 1 }}
      />,
    )
    const btns = screen.getAllByRole("button")
    fireEvent.click(btns[0])
    fireEvent.click(btns[1])
    expect(dec).toBe(0)
    expect(inc).toBe(0)
  })
})
