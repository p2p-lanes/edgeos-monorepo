import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PeopleContent } from "./PeopleContent"

const translations: Record<string, string> = {
  "people.title": "People",
  "people.description": "People you can manage for this event.",
  "people.primary": "Primary attendee",
  "people.dependent": "Dependent",
  "people.can_manage": "Managed by you",
  "people.empty_title": "No people yet",
  "people.empty_description": "People you manage will appear here.",
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}))

describe("PeopleContent", () => {
  it("shows a zero-ticket dependent with management rights and excludes tickets", () => {
    render(
      <PeopleContent
        people={[
          {
            id: "dependent",
            name: "Jamie Morgan",
            relationship: "dependent",
            canManage: true,
          },
        ]}
      />,
    )

    expect(screen.getByText("Jamie Morgan")).toBeTruthy()
    expect(screen.getByText("Dependent")).toBeTruthy()
    expect(screen.getByText("Managed by you")).toBeTruthy()
    expect(screen.queryByText("General Admission")).toBeNull()
  })

  it("shows the dedicated empty state when no authorized people exist", () => {
    render(<PeopleContent people={[]} />)

    expect(screen.getByText("No people yet")).toBeTruthy()
    expect(screen.getByText("People you manage will appear here.")).toBeTruthy()
  })
})
