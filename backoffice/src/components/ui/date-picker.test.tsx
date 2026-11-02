import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DatePicker } from "./date-picker"

afterEach(cleanup)

describe("DatePicker clearable", () => {
  it("clears a saved date", () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-11-03" onChange={onChange} clearable />)

    fireEvent.click(screen.getByRole("button", { name: "Clear date" }))

    expect(onChange).toHaveBeenCalledWith("")
  })

  it("hides the clear button when empty, disabled, or not clearable", () => {
    const { rerender } = render(
      <DatePicker value="" onChange={vi.fn()} clearable />,
    )
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull()

    rerender(
      <DatePicker value="2026-11-03" onChange={vi.fn()} clearable disabled />,
    )
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull()

    rerender(<DatePicker value="2026-11-03" onChange={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull()
  })
})
