/**
 * Choosing what a step renders with.
 *
 * A retired template is the interesting case, and it pulls in two
 * directions. It must stop being chosen, or the thing it was replaced by
 * never gets used. It must also stay visible and legible, because it is a
 * value on rows that already exist: tenants are still selling through steps
 * on it, and an operator who opens one has to be able to see what it is and
 * find their way off it. Hiding it would leave those steps showing a blank
 * template picker.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TEMPLATE_DEFINITIONS } from "./constants"
import { TemplatePicker } from "./TemplatePicker"

function card(name: RegExp) {
  return screen.getByRole("button", { name })
}

describe("a retired template", () => {
  it("cannot be picked for a step that is not already on it", () => {
    const onChange = vi.fn()
    render(<TemplatePicker value="ticket-select" onChange={onChange} />)

    const legacy = card(/Housing \(legacy\)/)
    expect(legacy.hasAttribute("disabled")).toBe(true)

    fireEvent.click(legacy)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("says what took its place", () => {
    render(<TemplatePicker value="ticket-select" onChange={vi.fn()} />)

    expect(screen.getByText("Replaced by Accommodation")).toBeTruthy()
  })

  it("stays usable on a step that already has it", () => {
    // Disabling it here would leave an operator on the old template with no
    // way to read what their step is, and no way to move off it.
    const onChange = vi.fn()
    render(<TemplatePicker value="housing-date" onChange={onChange} />)

    expect(card(/Housing \(legacy\)/).hasAttribute("disabled")).toBe(false)
    expect(screen.getByText(/Move this step to Accommodation/)).toBeTruthy()
  })

  it("lets that step switch to the replacement", () => {
    const onChange = vi.fn()
    render(<TemplatePicker value="housing-date" onChange={onChange} />)

    // By its description: the retired card's own note names Accommodation
    // too, so the label alone matches two buttons.
    fireEvent.click(card(/Rooms with real availability/))

    expect(onChange).toHaveBeenCalledWith("accommodation-booking")
  })
})

describe("every other template", () => {
  it("is still offered", () => {
    const onChange = vi.fn()
    render(<TemplatePicker value="" onChange={onChange} />)

    fireEvent.click(card(/Ticket Select/))
    expect(onChange).toHaveBeenCalledWith("ticket-select")
  })

  it("points at a replacement that exists", () => {
    // A `deprecatedBy` naming a key nobody defines would print the raw key
    // at an operator as if it were a product name.
    const keys = new Set(TEMPLATE_DEFINITIONS.map((def) => def.key))
    for (const def of TEMPLATE_DEFINITIONS) {
      if (def.deprecatedBy) expect(keys.has(def.deprecatedBy)).toBe(true)
    }
  })
})
