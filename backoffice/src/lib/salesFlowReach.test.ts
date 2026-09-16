import { describe, expect, it } from "vitest"
import type { SalesFlowPublic } from "@/client"
import { groupByReach, reachOf } from "./salesFlowReach"
import { WARNING_TEXT, warningText } from "./salesFlowReadiness"

const flow = (over: Partial<SalesFlowPublic>): SalesFlowPublic =>
  ({
    id: `id-${over.name}`,
    popup_id: "popup-1",
    tenant_id: "tenant-1",
    slug: "x",
    name: "X",
    type: "application",
    visibility: "portal_listed",
    is_default: false,
    ...over,
  }) as SalesFlowPublic

// The five real ways into Tech Summit 2025.
const DOORS = [
  flow({ name: "Attendee", type: "application", is_default: true }),
  flow({ name: "Volunteers", type: "application" }),
  flow({ name: "Scholarship", type: "application" }),
  flow({ name: "Sponsors", type: "direct", visibility: "direct_url_only" }),
  flow({ name: "Workshops", type: "upsale", visibility: "direct_url_only" }),
]

describe("reachOf", () => {
  it("puts a listed door where strangers can find it", () => {
    expect(reachOf(flow({ type: "application" }))).toBe("public")
    expect(reachOf(flow({ type: "direct" }))).toBe("public")
  })

  it("puts an unlisted door behind its link", () => {
    expect(
      reachOf(flow({ type: "direct", visibility: "direct_url_only" })),
    ).toBe("by_link")
  })

  it("puts an add-on after paying, listed or not", () => {
    // An add-on is not reached by browsing or by link the way the others are:
    // it appears on the passes page, to somebody who already bought. Being
    // unlisted is a fault to report on its row, not a different way in.
    expect(reachOf(flow({ type: "upsale" }))).toBe("after_paying")
    expect(
      reachOf(flow({ type: "upsale", visibility: "direct_url_only" })),
    ).toBe("after_paying")
  })
})

describe("groupByReach", () => {
  it("sorts the real gathering into the three ways in", () => {
    const groups = groupByReach(DOORS)
    expect(groups.map((g) => [g.id, g.flows.map((f) => f.name)])).toEqual([
      ["public", ["Attendee", "Volunteers", "Scholarship"]],
      ["by_link", ["Sponsors"]],
      ["after_paying", ["Workshops"]],
    ])
  })

  it("keeps the order a buyer meets them in", () => {
    const groups = groupByReach([...DOORS].reverse())
    expect(groups.map((g) => g.id)).toEqual([
      "public",
      "by_link",
      "after_paying",
    ])
  })

  it("keeps the order the API returned within a group", () => {
    const groups = groupByReach(DOORS)
    expect(groups[0].flows.map((f) => f.name)).toEqual([
      "Attendee",
      "Volunteers",
      "Scholarship",
    ])
  })

  it("drops the groups nobody has a door in", () => {
    // Three headings over a single way in describe the schema, not the
    // gathering. Most events have one door and should see one heading.
    const groups = groupByReach([flow({ name: "Attendee" })])
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe("public")
  })

  it("says nothing at all when there is nothing to say", () => {
    expect(groupByReach([])).toEqual([])
  })
})

describe("what being unlisted costs", () => {
  it("is a different sentence for an add-on than for a door that sells", () => {
    // A partner door is unlisted on purpose and works: the link is its
    // channel. An add-on is discovered on the passes page and only
    // portal-listed ones reach it, so unlisted means missing from the one
    // place its buyers look.
    expect(warningText("unlisted", "direct")).toContain(
      "reachable only by its link",
    )
    expect(warningText("unlisted", "upsale")).toContain("passes page")
  })

  it("leaves every other warning alone", () => {
    expect(warningText("accepts_everyone", "upsale")).toBe(
      WARNING_TEXT.accepts_everyone,
    )
  })

  it("shows an unknown code rather than swallowing it", () => {
    expect(warningText("something_new", "direct")).toBe("something_new")
  })
})
