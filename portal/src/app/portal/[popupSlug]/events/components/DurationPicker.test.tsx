import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { DurationDraft } from "../lib/eventDuration"
import { DurationPicker } from "./DurationPicker"

const COPY: Record<string, string> = {
  "events.form.hours": "Hours",
  "events.form.minutes": "Minutes",
  "events.form.duration_presets_label": "Common durations",
  "events.form.duration_preset_minutes": "{{minutes}} min",
  "events.form.duration_preset_hours": "{{hours}} h",
  "events.form.duration_preset_hours_minutes": "{{hours}} h {{minutes}} min",
  "events.form.duration_ends_at": "Ends at {{time}}",
  "events.form.duration_ends_at_on_date": "Ends at {{time}} on {{date}}",
  "events.form.duration_error_required": "Enter a duration.",
  "events.form.duration_error_invalid": "Enter a valid duration.",
  "events.form.duration_error_not_positive": "Duration must be greater than 0.",
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, values?: Record<string, string | number>) =>
      (COPY[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values?.[name] ?? ""),
      ),
  }),
}))

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
    <DurationPicker
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

describe("DurationPicker", () => {
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
    expect(
      screen.getByRole("button", { name: "1 h" }).getAttribute("aria-pressed"),
    ).toBe("false")
  })

  it("shows the live end time in the event timezone", () => {
    render(<Harness initial={{ hours: "1", minutes: "30" }} />)
    expect(screen.getByText("Ends at 16:30")).toBeTruthy()

    fireEvent.change(minutesInput(), { target: { value: "45" } })
    expect(screen.getByText("Ends at 16:45")).toBeTruthy()
  })

  it("shows the end date when the event runs past midnight", () => {
    render(<Harness initial={{ hours: "26", minutes: "0" }} />)
    expect(screen.getByText("Ends at 17:00 on Fri, Jun 5")).toBeTruthy()
  })

  it("hides the end time until a start time is set", () => {
    render(<Harness initial={{ hours: "1", minutes: "0" }} startIso="" />)
    expect(screen.queryByText(/Ends at/)).toBeNull()
  })

  it("shows an error for a zero duration instead of coercing it", () => {
    const onDraft = vi.fn()
    render(<Harness initial={{ hours: "1", minutes: "0" }} onDraft={onDraft} />)

    fireEvent.change(hoursInput(), { target: { value: "0" } })

    expect(screen.getByRole("alert").textContent).toBe(
      "Duration must be greater than 0.",
    )
    expect(hoursInput().getAttribute("aria-invalid")).toBe("true")
    expect(screen.queryByText(/Ends at/)).toBeNull()
    // The typed value is kept as-is, not bumped to 1 minute.
    expect(onDraft).toHaveBeenLastCalledWith({ hours: "0", minutes: "0" })
    expect(hoursInput().value).toBe("0")
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
    expect(minutesInput().value).toBe("30")
  })
})
