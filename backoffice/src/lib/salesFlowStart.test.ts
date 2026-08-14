import { describe, expect, it } from "vitest"
import type { SalesFlowPublic } from "@/client"
import {
  notCarriedAcross,
  START_EMPTY,
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
  it("always offers a fresh start and nothing at all", () => {
    const { offered } = startChoicesFor("application", [])
    expect(offered.map((o) => o.id)).toEqual([START_FRESH, START_EMPTY])
  })

  it("offers only doors that can produce the kind being opened", () => {
    const { offered } = startChoicesFor("direct", DOORS)
    expect(offered.map((o) => o.name)).toEqual([
      "A fresh one",
      "A copy of Sponsors",
      "Nothing at all",
    ])
  })

  it("keeps the other kinds out of the way rather than out of reach", () => {
    // The reason this is a separate list: an incompatible starting point is
    // never offered by default, so picking one cannot be an accident. It is
    // still reachable, because somebody wanting their partner's payment terms
    // on a reviewed door should not have to retype them.
    const { otherKinds } = startChoicesFor("direct", DOORS)
    expect(otherKinds.map((o) => o.name)).toEqual([
      "A copy of Attendee",
      "A copy of Volunteers",
      "A copy of Workshops",
    ])
    expect(otherKinds.every((o) => o.crossKind)).toBe(true)
  })

  it("says nothing can be copied when nothing of that kind exists", () => {
    const { offered } = startChoicesFor("upsale", [
      flow({ name: "Attendee", type: "application" }),
    ])
    expect(offered.filter((o) => o.kind === "copy")).toEqual([])
  })

  it("describes a door by what it would bring", () => {
    const { offered } = startChoicesFor("direct", DOORS)
    const sponsors = offered.find((o) => o.name === "A copy of Sponsors")
    expect(sponsors?.description).toContain("adds a contribution")
    expect(sponsors?.description).toContain("offers installments")
  })

  it("marks the flow everything else started from", () => {
    const { offered } = startChoicesFor("application", DOORS)
    const attendee = offered.find((o) => o.name === "A copy of Attendee")
    expect(attendee?.description).toContain("the flow others started from")
  })
})

describe("notCarriedAcross", () => {
  it("warns a reviewed door about the signing secret", () => {
    expect(notCarriedAcross("application").join(" ")).toContain(
      "signing secret",
    )
  })

  it("warns a selling door about the application settings", () => {
    const said = notCarriedAcross("direct").join(" ")
    expect(said).toContain("application form")
    expect(said).toContain("scholarships")
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
