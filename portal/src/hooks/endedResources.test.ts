import { describe, expect, it } from "vitest"
import type { PopupPublic } from "@/client"
import { buildEndedResources } from "./endedResources"

const t = (k: string) => k
const city = (over: Partial<PopupPublic>): PopupPublic =>
  ({
    id: "1",
    name: "P",
    slug: "p",
    status: "ended",
    events_enabled: true,
    show_attendee_directory: true,
    sale_type: "application",
    ...over,
  }) as PopupPublic

const byName = (rs: ReturnType<typeof buildEndedResources>) =>
  Object.fromEntries(rs.map((r) => [r.name, r.status]))

describe("buildEndedResources", () => {
  it("locks application and passes", () => {
    const rs = byName(
      buildEndedResources({ t, city: city({}), participated: true }),
    )
    expect(rs["sidebar.application"]).toBe("disabled")
    expect(rs["sidebar.passes"]).toBe("disabled")
  })

  it("shows events and directory to participants", () => {
    const rs = byName(
      buildEndedResources({ t, city: city({}), participated: true }),
    )
    expect(rs["sidebar.events"]).toBe("active")
    expect(rs["sidebar.attendee_directory"]).toBe("active")
  })

  it("hides events and directory for non-participants", () => {
    const rs = byName(
      buildEndedResources({ t, city: city({}), participated: false }),
    )
    expect(rs["sidebar.events"]).toBe("hidden")
    expect(rs["sidebar.attendee_directory"]).toBe("hidden")
  })

  it("respects the attendee directory flag", () => {
    const rs = byName(
      buildEndedResources({
        t,
        city: city({ show_attendee_directory: false }),
        participated: true,
      }),
    )
    expect(rs["sidebar.attendee_directory"]).toBe("hidden")
  })
})
