/**
 * Tests for FaqsDrawer (Task 10) — the Amanita skin's global FAQs drawer.
 *
 * Ported a11y VERBATIM from checkout-amanita/codigo/checkout/sections.tsx's
 * `FaqsDrawer`/`FaqList`: role=dialog + aria-modal, Escape closes, body-scroll
 * lock while open, and a 44x44 close button. No jest-dom in this project —
 * assertions use `getByRole`/`getByText`/`fireEvent`/`toBeTruthy()`.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import FaqsDrawer from "./FaqsDrawer"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const items = [
  { question: "What time does it start?", answer: "Doors open at noon." },
  { question: "Can I bring a tent?", answer: "Yes, camping is included." },
]

describe("FaqsDrawer", () => {
  beforeEach(() => {
    document.body.style.overflow = ""
  })
  afterEach(() => {
    document.body.style.overflow = ""
  })

  it("renders nothing when closed", () => {
    const { container } = render(
      <FaqsDrawer open={false} items={items} onClose={vi.fn()} />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it("renders a dialog with aria-modal when open, listing the FAQ items", () => {
    render(<FaqsDrawer open items={items} onClose={vi.fn()} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(screen.getByText("What time does it start?")).toBeTruthy()
    expect(screen.getByText("Can I bring a tent?")).toBeTruthy()
  })

  it("locks body scroll while open and restores it on close/unmount", () => {
    const { unmount } = render(
      <FaqsDrawer open items={items} onClose={vi.fn()} />,
    )
    expect(document.body.style.overflow).toBe("hidden")
    unmount()
    expect(document.body.style.overflow).toBe("")
  })

  it("calls onClose on Escape", () => {
    const onClose = vi.fn()
    render(<FaqsDrawer open items={items} onClose={onClose} />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("calls onClose when the close button is clicked, and the button is >=44x44", () => {
    const onClose = vi.fn()
    render(<FaqsDrawer open items={items} onClose={onClose} />)
    const closeButton = screen.getByRole("button", {
      name: "checkout.amanita.faqs_close_aria",
    })
    expect(closeButton.className).toContain("h-11")
    expect(closeButton.className).toContain("w-11")
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("focuses the close button on open and returns focus to the trigger on close", () => {
    const trigger = document.createElement("button")
    trigger.textContent = "FAQs"
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { rerender } = render(
      <FaqsDrawer open items={items} onClose={vi.fn()} />,
    )
    const closeButton = screen.getByRole("button", {
      name: "checkout.amanita.faqs_close_aria",
    })
    expect(document.activeElement).toBe(closeButton)

    rerender(<FaqsDrawer open={false} items={items} onClose={vi.fn()} />)
    expect(document.activeElement).toBe(trigger)

    document.body.removeChild(trigger)
  })
})
