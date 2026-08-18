import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { StepIconPicker } from "./StepIconPicker"

function setup(value: string) {
  const onChange = vi.fn()
  render(
    <StepIconPicker
      value={value}
      onChange={onChange}
      stepType="buyer"
      template="buyer-form"
    />,
  )
  return { onChange, user: userEvent.setup() }
}

describe("StepIconPicker", () => {
  it("emits the slug of the icon the operator clicks", async () => {
    const { onChange, user } = setup("")

    await user.click(screen.getByRole("button", { name: "Step icon" }))
    await user.click(screen.getByRole("button", { name: "Mushroom" }))

    expect(onChange).toHaveBeenCalledWith("mushroom")
  })

  it("filters the grid by label and by slug", async () => {
    const { user } = setup("")

    await user.click(screen.getByRole("button", { name: "Step icon" }))
    await user.type(screen.getByLabelText("Search icons"), "mushroom")

    expect(screen.getByRole("button", { name: "Mushroom" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Credit card" }),
    ).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText("Search icons"))
    await user.type(screen.getByLabelText("Search icons"), "credit-card")

    expect(screen.getByRole("button", { name: "Credit card" })).toBeVisible()
  })

  it("tells the operator when nothing matches", async () => {
    const { user } = setup("")

    await user.click(screen.getByRole("button", { name: "Step icon" }))
    await user.type(screen.getByLabelText("Search icons"), "zzzz")

    expect(screen.getByText(/no icons match/i)).toBeVisible()
  })

  it("emits an empty string when the operator picks the default", async () => {
    const { onChange, user } = setup("mushroom")

    await user.click(screen.getByRole("button", { name: "Step icon" }))
    await user.click(screen.getByRole("button", { name: /use the default/i }))

    expect(onChange).toHaveBeenCalledWith("")
  })

  it("keeps the emoji escape hatch, capped at 8 characters", async () => {
    const { onChange, user } = setup("")

    await user.click(screen.getByRole("button", { name: "Step icon" }))
    await user.click(screen.getByRole("tab", { name: "Emoji" }))
    await user.click(screen.getByLabelText("Step emoji"))
    // Pasted, not typed: user-event 14.6.1 splits astral characters on UTF-16
    // code units, so `type("🎉")` fires two lone-surrogate keystrokes. Against a
    // controlled input whose value prop never advances, they never recombine.
    await user.paste("🎉")

    expect(onChange).toHaveBeenCalledWith("🎉")

    onChange.mockClear()
    await user.clear(screen.getByLabelText("Step emoji"))
    await user.paste("123456789")

    expect(onChange).toHaveBeenLastCalledWith("12345678")
  })

  it("shows a literal emoji on the trigger instead of an icon", () => {
    setup("🎉")
    expect(screen.getByRole("button", { name: "Step icon" })).toHaveTextContent(
      "🎉",
    )
  })

  it("shows no literal text on the trigger when the value is a slug", () => {
    setup("mushroom")
    // Not `toHaveTextContent("")` — jest-dom rejects the empty string because
    // it would always match. Assert on the node's text directly instead.
    expect(screen.getByRole("button", { name: "Step icon" }).textContent).toBe(
      "",
    )
  })

  it("marks the selected icon as pressed for screen readers", async () => {
    const { user } = setup("mushroom")

    await user.click(screen.getByRole("button", { name: "Step icon" }))

    expect(screen.getByRole("button", { name: "Mushroom" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: "Credit card" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
  })

  it("resets the search query when the popover closes", async () => {
    const { user } = setup("")

    await user.click(screen.getByRole("button", { name: "Step icon" }))
    await user.type(screen.getByLabelText("Search icons"), "mushroom")
    expect(
      screen.queryByRole("button", { name: "Credit card" }),
    ).not.toBeInTheDocument()

    // Close (Escape) and reopen the popover.
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Step icon" }))

    expect(screen.getByLabelText("Search icons")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Credit card" })).toBeVisible()
  })
})
