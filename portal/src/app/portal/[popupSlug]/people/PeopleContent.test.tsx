import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import en from "@/i18n/locales/en.json"
import { PeopleContent } from "./PeopleContent"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      en.people[key.replace("people.", "") as keyof typeof en.people] ?? key,
  }),
}))

describe("PeopleContent", () => {
  it("shows a zero-ticket dependent with management rights and excludes tickets", () => {
    render(
      <PeopleContent
        popupSlug="egypt-eclipse"
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
    expect(screen.queryByRole("link", { name: "Browse tickets" })).toBeNull()
  })

  it("shows the dedicated empty state when no authorized people exist", () => {
    render(<PeopleContent people={[]} popupSlug="egypt-eclipse" />)

    expect(
      screen.getByRole("heading", { name: "You & companions", level: 1 }),
    ).toBeTruthy()
    expect(screen.getByText(en.people.description)).toBeTruthy()
    expect(screen.getByText("No attendees linked yet")).toBeTruthy()
    expect(screen.getByText(en.people.empty_description)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Browse tickets" }).getAttribute("href"),
    ).toBe("/portal/egypt-eclipse/shop")
  })
})
