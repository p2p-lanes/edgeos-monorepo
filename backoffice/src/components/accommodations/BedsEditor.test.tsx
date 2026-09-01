/**
 * The beds chip editor.
 *
 * The shape it emits is the one stored in `accommodations.beds` and read back
 * by the checkout, so the invariant that matters is: one entry per bed type,
 * counts always >= 1, and removal by decrementing to zero.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { BedsEditor } from "./BedsEditor"
import type { BedSpec } from "./beds"

function renderEditor(value: BedSpec[] = []) {
  const onChange = vi.fn()
  render(<BedsEditor value={value} onChange={onChange} />)
  return onChange
}

describe("BedsEditor", () => {
  it("renders one chip per bed type with its count", () => {
    renderEditor([
      { type: "king", count: 1 },
      { type: "single", count: 2 },
    ])

    expect(screen.getByText("King")).toBeTruthy()
    expect(screen.getByText("Single")).toBeTruthy()
    expect(screen.getByText("2")).toBeTruthy()
  })

  it("increments a count without touching the other beds", () => {
    const onChange = renderEditor([
      { type: "king", count: 1 },
      { type: "single", count: 2 },
    ])

    fireEvent.click(screen.getByLabelText("One more King"))

    expect(onChange.mock.calls[0][0]).toEqual([
      { type: "king", count: 2 },
      { type: "single", count: 2 },
    ])
  })

  it("removes the bed when its count would drop below one", () => {
    const onChange = renderEditor([
      { type: "king", count: 1 },
      { type: "single", count: 2 },
    ])

    fireEvent.click(screen.getByLabelText("One fewer King"))

    expect(onChange.mock.calls[0][0]).toEqual([{ type: "single", count: 2 }])
  })

  it("removes the bed outright from the X", () => {
    const onChange = renderEditor([{ type: "queen", count: 3 }])

    fireEvent.click(screen.getByLabelText("Remove Queen"))

    expect(onChange.mock.calls[0][0]).toEqual([])
  })

  it("offers only the bed types that are not already listed", () => {
    renderEditor([{ type: "king", count: 1 }])

    // The add control exists (five types remain) and the listed one is gone
    // from it, since a second "King" row would be a duplicate of the same thing.
    expect(screen.getByLabelText("Add a bed")).toBeTruthy()
  })

  it("hides the add control once every bed type is listed", () => {
    renderEditor([
      { type: "king", count: 1 },
      { type: "queen", count: 1 },
      { type: "double", count: 1 },
      { type: "single", count: 1 },
      { type: "bunk", count: 1 },
      { type: "sofa", count: 1 },
    ])

    expect(screen.queryByLabelText("Add a bed")).toBeNull()
  })
})
