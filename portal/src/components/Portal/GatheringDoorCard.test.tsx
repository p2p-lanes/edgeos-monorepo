import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { GatheringDoor } from "@/hooks/useGatheringDoors"
import { GatheringDoorCard } from "./GatheringDoorCard"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "portal.door_status.none": "Open",
        "portal.door_action.apply": "Apply",
      })[key] ?? key,
  }),
}))

const door: GatheringDoor = {
  flowId: "flow-attendee",
  name: "Attendee",
  slug: "attendee",
  application: null,
  status: "none",
}

describe("GatheringDoorCard", () => {
  beforeEach(() => push.mockClear())

  it("uses readable light-surface semantic colors for its content", () => {
    const { container } = render(
      <GatheringDoorCard door={door} popupSlug="gathering" showName />,
    )

    expect(container.firstElementChild?.className).toContain(
      "text-card-foreground",
    )
    expect(screen.getByText("Open").className).toContain(
      "text-muted-foreground",
    )
    expect(screen.getByRole("button", { name: "Apply" }).className).toContain(
      "text-card-foreground",
    )
  })

  it("keeps the selected flow in the application URL", () => {
    render(<GatheringDoorCard door={door} popupSlug="gathering" showName />)

    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    expect(push).toHaveBeenCalledWith(
      "/portal/gathering/application?flow=flow-attendee",
    )
  })
})
