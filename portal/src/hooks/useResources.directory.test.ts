import { describe, expect, it } from "vitest"
import { buildDirectoryResource } from "./useResources"

const t = (key: string) =>
  key === "sidebar.attendee_directory" ? "Directory" : key

describe("buildDirectoryResource", () => {
  it("keeps the localized Directory route and selected-flow query for authorized attendees", () => {
    expect(
      buildDirectoryResource({
        t,
        slug: "summit",
        flowQuery: "?flow=team",
        canSeeAttendees: true,
        attendeeDirectoryEnabled: true,
      }),
    ).toMatchObject({
      name: "Directory",
      path: "/portal/summit/attendees?flow=team",
      status: "active",
      group: "community",
    })
  })

  it("keeps Directory hidden when the popup disables the resource", () => {
    expect(
      buildDirectoryResource({
        t,
        slug: "summit",
        flowQuery: "?flow=team",
        canSeeAttendees: true,
        attendeeDirectoryEnabled: false,
      }).status,
    ).toBe("hidden")
  })

  it("keeps Directory hidden when the attendee is not authorized", () => {
    expect(
      buildDirectoryResource({
        t,
        slug: "summit",
        flowQuery: "",
        canSeeAttendees: false,
        attendeeDirectoryEnabled: true,
      }).status,
    ).toBe("hidden")
  })
})
