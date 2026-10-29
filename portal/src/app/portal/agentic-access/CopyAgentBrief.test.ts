import { describe, expect, it } from "vitest"
import { buildAgentBrief } from "./CopyAgentBrief"

const popup = { id: "11111111-1111-1111-1111-111111111111", name: "Edge India" }

describe("buildAgentBrief", () => {
  it("describes only the directory for a directory-only key", () => {
    const brief = buildAgentBrief({
      apiBase: "https://api.example.com",
      scopes: ["directory:read"],
      popup,
    })

    expect(brief).toContain(`GET /api/v1/applications/my/directory/${popup.id}`)
    expect(brief).toContain(`"Edge India" (popup_id ${popup.id})`)
    expect(brief).toContain('A value of "*" means the attendee hid it')
    expect(brief).not.toContain("Event calendar")
    expect(brief).not.toContain("occurrence_start")
    expect(brief).not.toContain("Write scopes")
  })

  it("lists only the event routes the scopes reach", () => {
    const brief = buildAgentBrief({
      apiBase: "https://api.example.com",
      scopes: ["events:read", "rsvp:write"],
      popup,
    })

    expect(brief).toContain("/api/v1/events/portal/events")
    expect(brief).toContain("/api/v1/event-participants/portal/register/")
    expect(brief).not.toContain("/cancel  (events:write)")
    expect(brief).not.toContain("POST   /api/v1/event-venues/portal/venues")
    expect(brief).not.toContain("Attendee directory")
    expect(brief).toContain("Write scopes (rsvp:write) expire")
    expect(brief).not.toContain("(events:write)")
    expect(brief).not.toContain("New events need")
  })

  it("explains event creation only to keys that can create events", () => {
    const brief = buildAgentBrief({
      apiBase: "https://api.example.com",
      scopes: ["events:read", "events:write"],
      popup,
    })

    expect(brief).toContain(
      "POST   /api/v1/events/portal/events  (events:write)",
    )
    expect(brief).toContain(
      "DELETE /api/v1/events/portal/events/{event_id}  (events:write)",
    )
    expect(brief).toContain("both custom_location_name and custom_location_url")
  })

  it("covers both modules and keeps a placeholder without a popup", () => {
    const brief = buildAgentBrief({
      apiBase: "https://api.example.com",
      scopes: ["events:read", "directory:read"],
      popup: null,
    })

    expect(brief).toContain(
      "work with the event calendar and read the attendee directory",
    )
    expect(brief).toContain("GET /api/v1/applications/my/directory/{popup_id}")
    expect(brief).toContain("bound to a single popup")
  })
})
