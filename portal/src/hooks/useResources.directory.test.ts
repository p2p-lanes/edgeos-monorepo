import { describe, expect, it } from "vitest"
import { buildDirectoryResource } from "./useResources"

const t = (key: string) =>
  key === "sidebar.attendee_directory" ? "Directory" : key

describe("buildDirectoryResource", () => {
  it("keeps the localized Directory route popup-scoped", () => {
    expect(
      buildDirectoryResource({
        t,
        slug: "summit",
        hasAcceptedParticipation: true,
        attendeeDirectoryEnabled: true,
      }),
    ).toMatchObject({
      name: "Directory",
      path: "/portal/summit/attendees",
      status: "active",
      group: "community",
    })
  })

  it("keeps Directory hidden when the popup disables the resource", () => {
    expect(
      buildDirectoryResource({
        t,
        slug: "summit",
        hasAcceptedParticipation: true,
        attendeeDirectoryEnabled: false,
      }).status,
    ).toBe("hidden")
  })

  it("keeps Directory hidden when the attendee is not authorized", () => {
    expect(
      buildDirectoryResource({
        t,
        slug: "summit",
        hasAcceptedParticipation: false,
        attendeeDirectoryEnabled: true,
      }).status,
    ).toBe("hidden")
  })
})
