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
import type { TicketRowVM } from "@/hooks/checkout/useTicketsStep"
import type { ProductsPass } from "@/types/Products"
import { ShowcaseProductRow, ShowcaseStepper } from "./VariantTicketCard"

describe("ShowcaseStepper", () => {
  const handlers = {
    onAdd: () => {},
    onIncrement: () => {},
    onDecrement: () => {},
  }

  it("renders a single add button at quantity 0", () => {
    render(
      <ShowcaseStepper
        quantity={0}
        max={5}
        disabled={false}
        label="GA"
        {...handlers}
      />,
    )
    const btns = screen.getAllByRole("button")
    expect(btns).toHaveLength(1)
    expect(btns[0].textContent).toBe("+")
  })

  it("renders the − n + pill at quantity >= 1", () => {
    render(
      <ShowcaseStepper
        quantity={2}
        max={5}
        disabled={false}
        label="GA"
        {...handlers}
      />,
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
        onIncrement={() => {
          inc += 1
        }}
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
        onIncrement={() => {
          inc += 1
        }}
        onDecrement={() => {
          dec += 1
        }}
      />,
    )
    const btns = screen.getAllByRole("button")
    fireEvent.click(btns[0])
    fireEvent.click(btns[1])
    expect(dec).toBe(0)
    expect(inc).toBe(0)
  })
})

function makeRow(overrides: Partial<TicketRowVM> = {}): TicketRowVM {
  const product: ProductsPass = {
    id: "prod-1",
    name: "Full Pass",
    price: 100,
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    slug: "full-pass",
    category: "pass",
  }
  return {
    product,
    selected: false,
    purchased: false,
    editedForCredit: false,
    disabled: false,
    saleState: "on_sale",
    quantity: 0,
    maxQuantity: 99,
    usesStepper: false,
    price: 100,
    comparePrice: null,
    ...overrides,
  }
}

describe("ShowcaseProductRow", () => {
  const noop = () => {}

  it("renders a single add toggle (not a stepper) when usesStepper is false", () => {
    const row = makeRow({ usesStepper: false, quantity: 0 })
    let toggled = 0
    let quantityChanged = 0
    render(
      <ShowcaseProductRow
        row={row}
        attendeeId="attendee-1"
        onToggle={() => {
          toggled += 1
        }}
        onQuantityChange={() => {
          quantityChanged += 1
        }}
      />,
    )
    const btns = screen.getAllByRole("button")
    expect(btns).toHaveLength(1)
    expect(screen.queryByText("−")).toBeNull()

    fireEvent.click(btns[0])
    expect(toggled).toBe(1)
    expect(quantityChanged).toBe(0)
  })

  it("renders a single add/remove toggle (not a stepper pill) when usesStepper is false and quantity >= 1", () => {
    const row = makeRow({ usesStepper: false, quantity: 1 })
    let toggled = 0
    let quantityChanged = 0
    render(
      <ShowcaseProductRow
        row={row}
        attendeeId="attendee-1"
        onToggle={() => {
          toggled += 1
        }}
        onQuantityChange={() => {
          quantityChanged += 1
        }}
      />,
    )
    const btns = screen.getAllByRole("button")
    expect(btns).toHaveLength(1)
    expect(screen.queryByText("−")).toBeNull()

    fireEvent.click(btns[0])
    expect(toggled).toBe(1)
    expect(quantityChanged).toBe(0)
  })

  it("renders the stepper pill when usesStepper is true", () => {
    const row = makeRow({ usesStepper: true, quantity: 1 })
    render(
      <ShowcaseProductRow
        row={row}
        attendeeId="attendee-1"
        onToggle={noop}
        onQuantityChange={noop}
      />,
    )
    const btns = screen.getAllByRole("button")
    expect(btns).toHaveLength(2)
    expect(screen.getByText("1")).toBeTruthy()
  })
})
