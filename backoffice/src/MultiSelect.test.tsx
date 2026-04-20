import { MultiSelect } from "@edgeos/shared-form-ui"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

const options = [
  { value: "music", label: "Music" },
  { value: "sports", label: "Sports" },
  { value: "art", label: "Art" },
]

describe("MultiSelect", () => {
  it("renders all options as buttons with aria-pressed=false when none selected", () => {
    render(<MultiSelect options={options} onChange={vi.fn()} />)

    for (const option of options) {
      const btn = screen.getByRole("button", {
        name: new RegExp(option.label, "i"),
      })
      expect(btn).toHaveAttribute("aria-pressed", "false")
    }
  })

  it("clicking unselected pill sets aria-pressed=true and calls onChange with [value]", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<MultiSelect options={options} onChange={onChange} />)

    const musicBtn = screen.getByRole("button", { name: /Music/i })
    await user.click(musicBtn)

    expect(musicBtn).toHaveAttribute("aria-pressed", "true")
    expect(onChange).toHaveBeenCalledWith(["music"])
  })

  it("clicking selected pill sets aria-pressed=false and calls onChange with []", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <MultiSelect
        options={options}
        onChange={onChange}
        defaultValue={["music"]}
      />,
    )

    const musicBtn = screen.getByRole("button", { name: /Music/i })
    expect(musicBtn).toHaveAttribute("aria-pressed", "true")

    await user.click(musicBtn)

    expect(musicBtn).toHaveAttribute("aria-pressed", "false")
    expect(onChange).toHaveBeenCalledWith([])
  })

  it("does not render Eye or EyeOff icons", () => {
    render(
      <MultiSelect
        options={options}
        onChange={vi.fn()}
        defaultValue={["music"]}
      />,
    )

    // lucide icons render as SVGs with data-lucide attribute
    const eyeIcons = document.querySelectorAll(
      "[data-lucide='Eye'], [data-lucide='EyeOff']",
    )
    expect(eyeIcons).toHaveLength(0)
  })

  it("renders Check icon element in both selected and unselected pills (stable slot)", () => {
    render(
      <MultiSelect
        options={options}
        onChange={vi.fn()}
        defaultValue={["music"]}
      />,
    )

    // All pills should have a span containing the icon slot (always present)
    const allButtons = screen.getAllByRole("button")
    // Every button should contain an SVG (the Check icon, either visible or opacity-0)
    for (const btn of allButtons) {
      const svg = btn.querySelector("svg")
      expect(svg).not.toBeNull()
    }
  })

  it("selected pill Check icon has opacity-100, unselected has opacity-0", () => {
    render(
      <MultiSelect
        options={options}
        onChange={vi.fn()}
        defaultValue={["music"]}
      />,
    )

    const musicBtn = screen.getByRole("button", { name: /Music/i })
    const sportsBtn = screen.getByRole("button", { name: /Sports/i })

    const selectedIcon = musicBtn.querySelector("svg")
    const unselectedIcon = sportsBtn.querySelector("svg")

    expect(selectedIcon?.getAttribute("class")).toContain("opacity-100")
    expect(unselectedIcon?.getAttribute("class")).toContain("opacity-0")
  })

  it("Space key toggles selection", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<MultiSelect options={options} onChange={onChange} />)

    const musicBtn = screen.getByRole("button", { name: /Music/i })
    musicBtn.focus()
    await user.keyboard(" ")

    expect(musicBtn).toHaveAttribute("aria-pressed", "true")
    expect(onChange).toHaveBeenCalledWith(["music"])
  })

  it("Enter key toggles selection", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<MultiSelect options={options} onChange={onChange} />)

    const musicBtn = screen.getByRole("button", { name: /Music/i })
    musicBtn.focus()
    await user.keyboard("{Enter}")

    expect(musicBtn).toHaveAttribute("aria-pressed", "true")
    expect(onChange).toHaveBeenCalledWith(["music"])
  })

  it("uses semantic color tokens — selected pill has bg-primary class", () => {
    render(
      <MultiSelect
        options={options}
        onChange={vi.fn()}
        defaultValue={["music"]}
      />,
    )

    const musicBtn = screen.getByRole("button", { name: /Music/i })
    expect(musicBtn.className).toContain("bg-primary")
    expect(musicBtn.className).not.toContain("bg-white")
  })

  it("unselected pill uses muted semantic tokens, not bg-white or text-gray-700", () => {
    render(<MultiSelect options={options} onChange={vi.fn()} />)

    const musicBtn = screen.getByRole("button", { name: /Music/i })
    expect(musicBtn.className).not.toContain("bg-white")
    expect(musicBtn.className).not.toContain("text-gray-700")
    expect(musicBtn.className).toContain("bg-muted")
  })
})
