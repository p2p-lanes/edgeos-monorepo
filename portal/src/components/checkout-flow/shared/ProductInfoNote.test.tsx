import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProductInfoNote } from "./ProductInfoNote"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
  }),
}))

const NOTE = "A passport will be requested for this product."
const LABEL = "checkout.product_info_note_label:Full Pass"

describe("ProductInfoNote", () => {
  it("renders nothing without a note", () => {
    const { container, rerender } = render(
      <ProductInfoNote note={null} productName="Full Pass" />,
    )
    expect(container.innerHTML).toBe("")

    rerender(<ProductInfoNote note="   " productName="Full Pass" />)
    expect(container.innerHTML).toBe("")
  })

  it("opens on tap and shows the note", () => {
    render(<ProductInfoNote note={NOTE} productName="Full Pass" />)
    expect(screen.queryByText(NOTE)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: LABEL }))

    expect(screen.getByText(NOTE)).toBeTruthy()
  })

  it("never selects the row it sits in", () => {
    const onRowClick = vi.fn()
    const onRowKeyDown = vi.fn()
    // Several product rows are themselves buttons that select the product.
    render(
      <button type="button" onClick={onRowClick} onKeyDown={onRowKeyDown}>
        <ProductInfoNote note={NOTE} productName="Full Pass" />
      </button>,
    )
    const trigger = screen.getByRole("button", { name: LABEL })

    fireEvent.click(trigger)
    // The popover is portalled, but React still bubbles its events to the row.
    fireEvent.click(screen.getByText(NOTE))
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.keyDown(trigger, { key: " " })

    expect(onRowClick).not.toHaveBeenCalled()
    expect(onRowKeyDown).not.toHaveBeenCalled()
  })

  it("opens from the keyboard", () => {
    render(<ProductInfoNote note={NOTE} productName="Full Pass" />)

    fireEvent.keyDown(screen.getByRole("button", { name: LABEL }), {
      key: "Enter",
    })

    expect(screen.getByText(NOTE)).toBeTruthy()
  })
})
