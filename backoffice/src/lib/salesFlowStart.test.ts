import { describe, expect, it } from "vitest"
import type { SalesFlowPublic } from "@/client"
import {
  autoStart,
  START_FRESH,
  slugifyFlowName,
  startChoicesFor,
} from "./salesFlowStart"

const flow = (over: Partial<SalesFlowPublic>): SalesFlowPublic =>
  ({
    id: `id-${over.name}`,
    popup_id: "popup-1",
    tenant_id: "tenant-1",
    slug: "x",
    name: "X",
    type: "application",
    is_default: false,
    ...over,
  }) as SalesFlowPublic

const DOORS = [
  flow({ name: "Attendee", type: "application", is_default: true }),
  flow({ name: "Volunteers", type: "application" }),
  flow({
    name: "Sponsors",
    type: "direct",
    contribution_enabled: true,
    installments_enabled: true,
  }),
  flow({ name: "Workshops", type: "upsale" }),
]

describe("startChoicesFor", () => {
  it("always offers starting from nothing", () => {
    // One option, not two. "A fresh one" and "nothing at all" were the same
    // thing under different names once a kind of flow stopped carrying
    // preset values.
    const { offered } = startChoicesFor("application", [])
    expect(offered.map((o) => o.id)).toEqual([START_FRESH])
  })

  it("offers only doors that can produce the kind being opened", () => {
    const { offered } = startChoicesFor("direct", DOORS)
    expect(offered.map((o) => o.name)).toEqual([
      "Start from scratch",
      "A copy of Sponsors",
    ])
  })

  it("never offers flows of another kind as copy sources", () => {
    const { offered } = startChoicesFor("direct", DOORS)
    expect(offered.map((o) => o.name)).not.toContain("A copy of Attendee")
    expect(offered.map((o) => o.name)).not.toContain("A copy of Workshops")
  })

  it("says nothing can be copied when nothing of that kind exists", () => {
    const { offered } = startChoicesFor("upsale", [
      flow({ name: "Attendee", type: "application" }),
    ])
    expect(offered.filter((o) => o.kind === "copy")).toEqual([])
  })

  it("describes a flow in facts, briefly", () => {
    const { offered } = startChoicesFor("direct", DOORS)
    const sponsors = offered.find((o) => o.name === "A copy of Sponsors")
    expect(sponsors?.description).toBe("contribution · installments")
  })

  it("says nothing rather than filling the line", () => {
    // The fallback used to read "its settings as they stand", which is a
    // sentence that costs a line and answers nothing.
    const { offered } = startChoicesFor("application", DOORS)
    const attendee = offered.find((o) => o.name === "A copy of Attendee")
    expect(attendee?.description).toBe("")
  })
})

describe("slugifyFlowName", () => {
  it("makes a link out of a name", () => {
    expect(slugifyFlowName("Partner sales")).toBe("partner-sales")
  })

  it("strips accents rather than dropping the letter", () => {
    expect(slugifyFlowName("Becas Región")).toBe("becas-region")
  })

  it("is empty when there is nothing to slug", () => {
    expect(slugifyFlowName("   ")).toBe("")
    expect(slugifyFlowName("!!!")).toBe("")
  })
})

describe("autoStart", () => {
  const decide = (
    type: Parameters<typeof startChoicesFor>[0],
    flows: SalesFlowPublic[],
  ) => autoStart(startChoicesFor(type, flows))

  it("takes the only sensible answer when there is nothing to copy", () => {
    // No add-on exists yet, so there is nothing of that kind to copy.
    expect(
      decide("upsale", [flow({ name: "Attendee", type: "application" })])?.id,
    ).toBe(START_FRESH)
  })

  it("starts fresh even when exactly one same-kind source exists", () => {
    const decision = decide("application", [
      flow({ name: "Attendee", type: "application", is_default: true }),
    ])
    expect(decision?.id).toBe(START_FRESH)
  })

  it("starts fresh when there are multiple same-kind sources", () => {
    expect(decide("application", DOORS)?.id).toBe(START_FRESH)
  })

  it("starts fresh when other kinds exist", () => {
    const decision = decide("direct", [
      flow({ name: "Attendee", type: "application" }),
      flow({ name: "Volunteers", type: "application" }),
      flow({ name: "Sponsors", type: "direct" }),
    ])
    expect(decision?.id).toBe(START_FRESH)
  })

  it("has an answer even for a gathering with no flows at all", () => {
    expect(decide("application", [])?.id).toBe(START_FRESH)
  })
})
