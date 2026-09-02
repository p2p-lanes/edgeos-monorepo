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
    takes_applications: true,
    sells_directly: false,
    ...over,
  }) as PopupPublic

const byName = (rs: ReturnType<typeof buildEndedResources>) =>
  Object.fromEntries(rs.map((r) => [r.name, r.status]))

describe("buildEndedResources", () => {
  it("keeps application active and exposes read-only access", () => {
    const rs = byName(
      buildEndedResources({ t, city: city({}), participated: true }),
    )
    expect(rs["sidebar.application"]).toBe("active")
    expect(rs["sidebar.tickets_access"]).toBe("active")
    expect(rs["sidebar.passes"]).toBeUndefined()
  })

  it("keeps orders available as read-only history", () => {
    const rs = byName(
      buildEndedResources({ t, city: city({}), participated: false }),
    )
    expect(rs["sidebar.orders"]).toBe("active")
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

  it("hides the directory where nobody applies", () => {
    const rs = byName(
      buildEndedResources({
        t,
        city: city({ takes_applications: false, sells_directly: true }),
        participated: true,
      }),
    )
    expect(rs["sidebar.attendee_directory"]).toBe("hidden")
  })

  it("keeps the directory when a gathering both takes applications and sells", () => {
    // The case the popup's `sale_type` could never express, and the reason
    // this stopped reading it: one door reviews people, another sells to
    // them. The reviewed people still have a directory.
    const rs = byName(
      buildEndedResources({
        t,
        city: city({
          sale_type: "direct",
          takes_applications: true,
          sells_directly: true,
        }),
        participated: true,
      }),
    )
    expect(rs["sidebar.attendee_directory"]).toBe("active")
  })
})
