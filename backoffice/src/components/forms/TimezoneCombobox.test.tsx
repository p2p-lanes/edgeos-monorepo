import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TimezoneCombobox } from "./TimezoneCombobox"

function setup(value: string, disabled = false) {
  const onChange = vi.fn()
  render(
    <TimezoneCombobox value={value} onChange={onChange} disabled={disabled} />,
  )
  return { onChange, user: userEvent.setup() }
}

const trigger = () => screen.getByRole("combobox", { name: "Default timezone" })
const search = () =>
  screen.getByPlaceholderText("Search city, country or GMT offset…")

describe("TimezoneCombobox", () => {
  it("shows the current zone and its offset on the trigger", () => {
    setup("Europe/Madrid")
    expect(trigger()).toHaveTextContent(/^Europe\/Madrid \(GMT[+-]\d/)
  })

  it("emits the zone the operator picks after searching a country", async () => {
    const { onChange, user } = setup("UTC")

    await user.click(trigger())
    await user.type(search(), "spain")
    await user.click(await screen.findByText("Madrid · Spain"))

    expect(onChange).toHaveBeenCalledWith("Europe/Madrid")
  })

  it("finds a zone the old hardcoded list never offered", async () => {
    const { onChange, user } = setup("UTC")

    await user.click(trigger())
    await user.type(search(), "nairobi")
    await user.click(await screen.findByText("Nairobi · Kenya"))

    expect(onChange).toHaveBeenCalledWith("Africa/Nairobi")
  })

  it("keeps a zone it does not list selectable on the trigger", () => {
    setup("Foo/Bar")
    expect(trigger()).toHaveTextContent("Foo/Bar")
  })

  it("resolves a historical id onto the zone it lists", () => {
    setup("Asia/Calcutta")
    expect(trigger()).toHaveTextContent(/^Asia\/Kolkata/)
  })

  it("says so when nothing matches", async () => {
    const { user } = setup("UTC")

    await user.click(trigger())
    await user.type(search(), "zzzz")

    expect(
      await screen.findByText("No timezone matches that search."),
    ).toBeVisible()
  })

  it("cannot be opened in read-only mode", () => {
    setup("UTC", true)
    expect(trigger()).toBeDisabled()
  })
})
