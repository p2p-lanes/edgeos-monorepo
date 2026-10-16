import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { DurationDraft } from "@/lib/events/eventDuration"
import { DurationInput } from "./DurationInput"

// 15:00 in Los Angeles (UTC-7 in June).
const START_ISO = "2026-06-04T22:00:00.000Z"

function Harness({
  initial,
  startIso = START_ISO,
  onDraft,
}: {
  initial: DurationDraft
  startIso?: string
  onDraft?: (draft: DurationDraft) => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <DurationInput
      draft={draft}
      onChange={(next) => {
        setDraft(next)
        onDraft?.(next)
      }}
      startIso={startIso}
      timeZone="America/Los_Angeles"
    />
  )
}

const hoursInput = () => screen.getByLabelText("Hours") as HTMLInputElement
const minutesInput = () => screen.getByLabelText("Minutes") as HTMLInputElement

describe("DurationInput", () => {
  it("applies a quick pick to the hours and minutes fields", () => {
    const onDraft = vi.fn()
    render(<Harness initial={{ hours: "1", minutes: "0" }} onDraft={onDraft} />)

    expect(
      screen.getByRole("button", { name: "1 h" }).getAttribute("aria-pressed"),
    ).toBe("true")

    fireEvent.click(screen.getByRole("button", { name: "1 h 30 min" }))

    expect(onDraft).toHaveBeenLastCalledWith({ hours: "1", minutes: "30" })
    expect(hoursInput().value).toBe("1")
    expect(minutesInput().value).toBe("30")
    expect(
      screen
        .getByRole("button", { name: "1 h 30 min" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
  })

  it("shows the live end time in the event timezone", () => {
    render(<Harness initial={{ hours: "1", minutes: "30" }} />)
    expect(screen.getByText("Ends at 16:30")).toBeTruthy()

    fireEvent.change(hoursInput(), { target: { value: "2" } })
    expect(screen.getByText("Ends at 17:30")).toBeTruthy()
  })

  it("shows the end date when the event runs past midnight", () => {
    render(<Harness initial={{ hours: "26", minutes: "0" }} />)
    expect(screen.getByText("Ends at 17:00 on Fri, Jun 5")).toBeTruthy()
  })

  it("shows an error for a zero duration instead of coercing it", () => {
    const onDraft = vi.fn()
    render(<Harness initial={{ hours: "1", minutes: "0" }} onDraft={onDraft} />)

    fireEvent.change(hoursInput(), { target: { value: "0" } })

    expect(screen.getByRole("alert").textContent).toBe(
      "Duration must be greater than 0.",
    )
    expect(minutesInput().getAttribute("aria-invalid")).toBe("true")
    expect(screen.queryByText(/Ends at/)).toBeNull()
    expect(onDraft).toHaveBeenLastCalledWith({ hours: "0", minutes: "0" })
  })

  it("asks for a duration when both fields are cleared", () => {
    render(<Harness initial={{ hours: "1", minutes: "0" }} />)
    fireEvent.change(hoursInput(), { target: { value: "" } })
    fireEvent.change(minutesInput(), { target: { value: "" } })
    expect(screen.getByRole("alert").textContent).toBe("Enter a duration.")
  })

  it("keeps decimal hours and settles them as hours and minutes on blur", () => {
    const onDraft = vi.fn()
    render(<Harness initial={{ hours: "1", minutes: "0" }} onDraft={onDraft} />)

    fireEvent.change(hoursInput(), { target: { value: "1.5" } })
    expect(screen.getByText("Ends at 16:30")).toBeTruthy()

    fireEvent.blur(hoursInput())
    expect(onDraft).toHaveBeenLastCalledWith({ hours: "1", minutes: "30" })
  })
})
