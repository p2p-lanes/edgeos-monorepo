import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { PopupPublic } from "@/client"
import { EventCard } from "./EventCard"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const popup = {
  id: "popup-1",
  name: "Test gathering",
  slug: "test-gathering",
} as PopupPublic

describe("EventCard withdrawn state", () => {
  it("does not offer to resume a withdrawn application", () => {
    render(
      <EventCard popup={popup} status="withdrawn">
        <EventCard.ApplyButton onClick={vi.fn()} />
      </EventCard>,
    )
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("still offers to continue a draft application", () => {
    render(
      <EventCard popup={popup} status="draft">
        <EventCard.ApplyButton onClick={vi.fn()} />
      </EventCard>,
    )
    expect(screen.getByRole("button", { name: "cta.draft" })).toBeTruthy()
  })
})
