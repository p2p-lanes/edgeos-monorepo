import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { RsvpStatusAction } from "./RsvpStatusAction"

const GOING = "events.rsvp.going"
const CANCEL = "events.rsvp.cancel"
const CONFIRM = "events.rsvp.cancel_confirm_confirm"
const KEEP = "events.rsvp.cancel_confirm_keep"

describe("RsvpStatusAction", () => {
  it("renders the status as plain text, not a button", () => {
    render(<RsvpStatusAction onCancelRsvp={vi.fn()} />)

    expect(screen.getByText(GOING)).toBeTruthy()
    // Only the cancel action is a button; "Going" must not be clickable
    // or focusable.
    const buttons = screen.getAllByRole("button")
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toContain(CANCEL)
  })

  it("does not cancel until the dialog is confirmed", () => {
    const onCancelRsvp = vi.fn()
    render(<RsvpStatusAction onCancelRsvp={onCancelRsvp} />)

    fireEvent.click(screen.getByRole("button", { name: new RegExp(CANCEL) }))
    expect(onCancelRsvp).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(CONFIRM))
    expect(onCancelRsvp).toHaveBeenCalledTimes(1)
  })

  it("does not cancel when the dialog is dismissed", () => {
    const onCancelRsvp = vi.fn()
    render(<RsvpStatusAction onCancelRsvp={onCancelRsvp} />)

    fireEvent.click(screen.getByRole("button", { name: new RegExp(CANCEL) }))
    fireEvent.click(screen.getByText(KEEP))

    expect(screen.queryByText(CONFIRM)).toBeNull()
    expect(onCancelRsvp).not.toHaveBeenCalled()
  })

  it("blocks a second cancel while one is in flight", () => {
    const onCancelRsvp = vi.fn()
    render(<RsvpStatusAction isPending onCancelRsvp={onCancelRsvp} />)

    const trigger = screen.getByRole("button", { name: new RegExp(CANCEL) })
    expect((trigger as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(trigger)
    expect(screen.queryByText(CONFIRM)).toBeNull()
    expect(onCancelRsvp).not.toHaveBeenCalled()
  })

  it("hides the cancel action when it is not offered", () => {
    render(<RsvpStatusAction showCancel={false} onCancelRsvp={vi.fn()} />)

    expect(screen.getByText(GOING)).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("keeps the wording as the accessible name at mini size", () => {
    render(<RsvpStatusAction size="mini" onCancelRsvp={vi.fn()} />)

    const trigger = screen.getByRole("button", { name: CANCEL })
    expect(trigger.textContent).not.toContain(CANCEL)
  })
})
