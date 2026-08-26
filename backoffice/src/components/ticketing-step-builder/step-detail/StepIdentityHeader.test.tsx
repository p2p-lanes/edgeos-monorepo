import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { StepIdentityHeader } from "./StepIdentityHeader"

function setup(emoji: string) {
  const onEmojiChange = vi.fn()
  render(
    <StepIdentityHeader
      stepType="buyer"
      emoji={emoji}
      onEmojiChange={onEmojiChange}
      title="Your information"
      onTitleChange={vi.fn()}
      template="buyer-form"
    />,
  )
  return { onEmojiChange, user: userEvent.setup() }
}

describe("StepIdentityHeader", () => {
  it("renders a picker instead of a free-text icon field", () => {
    setup("")
    expect(screen.getByRole("button", { name: "Step icon" })).toBeVisible()
    expect(screen.queryByLabelText("Step emoji")).not.toBeInTheDocument()
  })

  it("forwards the operator's icon choice", async () => {
    const { onEmojiChange, user } = setup("")

    await user.click(screen.getByRole("button", { name: "Step icon" }))
    await user.click(screen.getByRole("button", { name: "Mushroom" }))

    expect(onEmojiChange).toHaveBeenCalledWith("mushroom")
  })

  it("still edits the title", async () => {
    render(
      <StepIdentityHeader
        stepType="buyer"
        emoji=""
        onEmojiChange={vi.fn()}
        title="Your information"
        onTitleChange={vi.fn()}
        template="buyer-form"
      />,
    )
    expect(screen.getByLabelText("Title")).toHaveValue("Your information")
  })
})
