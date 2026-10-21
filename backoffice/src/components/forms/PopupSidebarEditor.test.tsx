import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import {
  type PopupSidebarConfig,
  PopupSidebarEditor,
} from "./PopupSidebarEditor"

function SidebarEditorHarness() {
  const [config, setConfig] = useState<PopupSidebarConfig | null>(null)
  return (
    <PopupSidebarEditor value={config} onChange={setConfig} disabled={false} />
  )
}

describe("PopupSidebarEditor", () => {
  it("adds an external-link section and lets its title and link be edited", async () => {
    const user = userEvent.setup()
    render(<SidebarEditorHarness />)

    await user.click(screen.getByRole("button", { name: "Add section" }))
    const sectionTitles = screen.getAllByRole("textbox", {
      name: "Section title",
    })
    const externalTitle = sectionTitles[sectionTitles.length - 1]
    const externalSection = externalTitle.closest("li")
    if (!externalSection) throw new Error("External section is missing")
    await user.clear(externalTitle)
    await user.type(externalTitle, "More information")
    await user.type(
      within(externalSection).getByRole("textbox", { name: "New link name" }),
      "Venue",
    )
    await user.type(
      within(externalSection).getByRole("textbox", { name: "New link URL" }),
      "https://example.com",
    )
    await user.click(
      within(externalSection).getByRole("button", { name: "Add link" }),
    )

    expect(screen.getByDisplayValue("More information")).toBeTruthy()
    expect(screen.getByDisplayValue("Venue")).toBeTruthy()
    expect(screen.getByDisplayValue("https://example.com")).toBeTruthy()
  })

  it("puts Home outside sections at the top and lets Tracks be hidden", async () => {
    const user = userEvent.setup()
    const { container } = render(<SidebarEditorHarness />)

    await user.click(
      screen.getByRole("button", { name: "Remove Home from section" }),
    )
    await user.click(
      screen.getByRole("button", { name: "Add Home at top level" }),
    )
    for (let step = 0; step < 3; step += 1) {
      await user.click(screen.getByRole("button", { name: "Move home up" }))
    }

    expect(
      container.querySelector("ol")?.firstElementChild?.textContent,
    ).toContain("Home")

    const tracks = screen.getByRole("checkbox", { name: "Tracks" })
    expect(tracks).toBeChecked()
    await user.click(tracks)
    expect(tracks).not.toBeChecked()
  })
})
