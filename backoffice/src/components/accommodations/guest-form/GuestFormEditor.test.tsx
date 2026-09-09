/**
 * The guest-form editor.
 *
 * Drag reordering is dnd-kit's and is not re-tested here. What is worth
 * pinning is the behaviour an operator would notice going wrong: a preset
 * opens the editor rather than looping back to the picker, a renamed
 * question keeps the key its answers are stored under, and the guests mode
 * changes what the other occupants are asked without touching the list.
 */

import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { GuestFormEditor } from "./GuestFormEditor"
import { emptyForm, type GuestFormValue, makeField } from "./guestForm"

/** The editor is controlled, so the tests drive it through a real owner. */
function Harness({
  initial,
  onChange,
}: {
  initial: GuestFormValue
  onChange?: (form: GuestFormValue) => void
}) {
  const [form, setForm] = useState(initial)
  return (
    <GuestFormEditor
      value={form}
      onChange={(next) => {
        setForm(next)
        onChange?.(next)
      }}
    />
  )
}

/** The editable input for a question.
 *
 * Under the default guests mode the booking contact's questions are echoed
 * read-only below, so every label matches twice. The first is the real one.
 */
function question(label: string): HTMLElement {
  return screen.getAllByDisplayValue(label)[0]
}

function formWith(...labels: [string, string][]): GuestFormValue {
  const form = emptyForm()
  for (const [type, label] of labels) {
    form.booker.fields.push(
      makeField(
        type,
        label,
        form.booker.fields.map((f) => f.key),
      ),
    )
  }
  return form
}

describe("what the checkout already asks", () => {
  it("says so on a question the buyer answers elsewhere", () => {
    // Without this an operator adds an email question, previews the step,
    // does not find it, and concludes the editor is broken.
    render(<Harness initial={formWith(["email", "Email"])} />)

    expect(
      screen.getAllByText(/already asks the buyer for this/).length,
    ).toBeGreaterThan(0)
  })

  it("says it conditionally for a phone, which not every buyer form asks", () => {
    render(<Harness initial={formWith(["phone", "Phone"])} />)

    expect(
      screen.getAllByText(/if your buyer form already asks/).length,
    ).toBeGreaterThan(0)
  })

  it("stays quiet about a question that is genuinely the property's", () => {
    render(<Harness initial={formWith(["text", "Passport number"])} />)

    expect(screen.queryByText(/already asks the buyer/)).toBeNull()
  })
})

describe("starting out", () => {
  it("offers presets while the form is empty", () => {
    render(<Harness initial={emptyForm()} />)

    expect(screen.getByText("Hotel registry")).toBeTruthy()
    expect(screen.queryByText("Booking contact")).toBeNull()
  })

  it("opens the editor on a preset, with its questions in place", async () => {
    render(<Harness initial={emptyForm()} />)

    await userEvent.click(screen.getByText("A phone number"))

    expect(screen.getByText("Booking contact")).toBeTruthy()
    expect(question("Phone")).toBeTruthy()
  })

  it("opens an empty editor on start from scratch, not the picker again", async () => {
    // The form is still empty here, so a naive "show presets when empty"
    // would put the operator back where they started, forever.
    render(<Harness initial={emptyForm()} />)

    await userEvent.click(screen.getByText("Start from scratch"))

    expect(screen.getByText("Booking contact")).toBeTruthy()
    expect(screen.queryByText("Hotel registry")).toBeNull()
  })

  it("goes straight to the editor when questions already exist", () => {
    render(<Harness initial={formWith(["email", "Email"])} />)

    expect(screen.getByText("Booking contact")).toBeTruthy()
    expect(screen.queryByText("Hotel registry")).toBeNull()
  })
})

describe("editing questions", () => {
  it("adds a question of the chosen type", async () => {
    const onChange = vi.fn()
    render(
      <Harness initial={formWith(["email", "Email"])} onChange={onChange} />,
    )

    await userEvent.click(
      screen.getAllByRole("button", { name: "Add question" })[0],
    )
    await userEvent.click(screen.getByRole("menuitem", { name: /Date/ }))

    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.booker.fields.map((field) => field.type)).toEqual([
      "email",
      "date",
    ])
  })

  it("keeps the key when the question is renamed", async () => {
    const onChange = vi.fn()
    render(
      <Harness initial={formWith(["number", "Age"])} onChange={onChange} />,
    )

    await userEvent.type(question("Age"), " at check-in")

    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.booker.fields[0].label).toBe("Age at check-in")
    expect(form.booker.fields[0].key).toBe("age")
  })

  it("removes a question", async () => {
    const onChange = vi.fn()
    render(
      <Harness
        initial={formWith(["email", "Email"], ["phone", "Phone"])}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole("button", { name: "Remove Phone" }))

    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.booker.fields.map((field) => field.label)).toEqual(["Email"])
  })

  it("flags a question that cannot be saved", async () => {
    render(
      <Harness initial={formWith(["text", "Full name"])} onChange={vi.fn()} />,
    )

    await userEvent.clear(question("Full name"))

    expect(screen.getByText(/needs a label/)).toBeTruthy()
  })

  it("gives a new choice question options, so it starts valid", async () => {
    const onChange = vi.fn()
    render(<Harness initial={emptyForm()} onChange={onChange} />)
    await userEvent.click(screen.getByText("Start from scratch"))

    await userEvent.click(screen.getByRole("button", { name: "Add question" }))
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Select \(Single\)/ }),
    )

    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.booker.fields[0].options.length).toBeGreaterThan(0)
    expect(screen.queryByText(/at least one option/)).toBeNull()
  })
})

describe("the other guests", () => {
  it("echoes the booking contact questions, read-only, under the default mode", () => {
    render(<Harness initial={formWith(["email", "Email"])} />)

    // Two rows for one question: the editable one and the echo.
    expect(screen.getAllByDisplayValue("Email")).toHaveLength(2)
    expect(
      screen.getAllByRole("button", { name: "Remove Email" }),
    ).toHaveLength(1)
  })

  it("asks the other guests nothing under off", async () => {
    const onChange = vi.fn()
    render(
      <Harness initial={formWith(["email", "Email"])} onChange={onChange} />,
    )

    await userEvent.click(screen.getByLabelText("Other guests"))
    await userEvent.click(screen.getByRole("option", { name: "Nothing" }))

    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.guests.mode).toBe("off")
    // The booking contact's questions are untouched: the mode says who is asked,
    // not what exists.
    expect(form.booker.fields).toHaveLength(1)
    expect(screen.getAllByDisplayValue("Email")).toHaveLength(1)
  })

  it("gives the other guests their own list under custom", async () => {
    const onChange = vi.fn()
    render(
      <Harness initial={formWith(["email", "Email"])} onChange={onChange} />,
    )

    await userEvent.click(screen.getByLabelText("Other guests"))
    await userEvent.click(screen.getByRole("option", { name: "A shorter set" }))

    const addButtons = screen.getAllByRole("button", { name: "Add question" })
    expect(addButtons).toHaveLength(2)

    await userEvent.click(addButtons[1])
    await userEvent.click(screen.getByRole("menuitem", { name: /^Text$/ }))

    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.guests.fields).toHaveLength(1)
    expect(form.booker.fields).toHaveLength(1)
  })

  it("keeps keys unique across both sections", async () => {
    const onChange = vi.fn()
    render(<Harness initial={formWith(["text", "Text"])} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText("Other guests"))
    await userEvent.click(screen.getByRole("option", { name: "A shorter set" }))
    await userEvent.click(
      screen.getAllByRole("button", { name: "Add question" })[1],
    )
    await userEvent.click(screen.getByRole("menuitem", { name: /^Text$/ }))

    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.guests.fields[0].key).not.toBe(form.booker.fields[0].key)
  })
})

describe("preview", () => {
  it("shows the real control for each question", async () => {
    render(<Harness initial={formWith(["email", "Email"])} />)

    await userEvent.click(screen.getByRole("button", { name: /Preview/ }))

    const preview = screen.getByText("Preview").closest("div")
    expect(preview).toBeTruthy()
    expect(
      within(preview as HTMLElement).getAllByText("Email").length,
    ).toBeGreaterThan(0)
  })
})

describe("clearing", () => {
  it("returns to the presets so the next choice is one click", async () => {
    const onChange = vi.fn()
    render(
      <Harness initial={formWith(["email", "Email"])} onChange={onChange} />,
    )

    await userEvent.click(
      screen.getByRole("button", { name: "Clear all questions" }),
    )

    expect(screen.getByText("Hotel registry")).toBeTruthy()
    const form = onChange.mock.lastCall?.[0] as GuestFormValue
    expect(form.booker.fields).toEqual([])
  })
})
