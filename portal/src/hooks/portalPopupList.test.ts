import { describe, expect, it } from "vitest"
import type { PopupPublic } from "@/client"
import { visiblePortalFallback, visiblePortalPopups } from "./portalPopupList"

const popup = (over: Partial<PopupPublic>): PopupPublic =>
  ({
    id: over.id ?? crypto.randomUUID(),
    name: over.name ?? "P",
    slug: over.slug ?? "p",
    status: over.status ?? "active",
    start_date: over.start_date ?? null,
    ...over,
  }) as PopupPublic

describe("visiblePortalPopups", () => {
  it("keeps active and ended, drops draft/archived", () => {
    const result = visiblePortalPopups([
      popup({ name: "a", status: "active" }),
      popup({ name: "e", status: "ended" }),
      popup({ name: "d", status: "draft" }),
      popup({ name: "ar", status: "archived" }),
    ])
    expect(result.map((p) => p.name)).toEqual(["a", "e"])
  })

  it("sorts active before ended", () => {
    const result = visiblePortalPopups([
      popup({ name: "ended", status: "ended", start_date: "2020-01-01" }),
      popup({ name: "active", status: "active", start_date: "2030-01-01" }),
    ])
    expect(result.map((p) => p.name)).toEqual(["active", "ended"])
  })
})

describe("visiblePortalFallback", () => {
  it("preserves the last popup only while it remains visible", () => {
    const first = popup({ id: "active-1", slug: "first" })
    const last = popup({ id: "active-2", slug: "last" })

    expect(visiblePortalFallback([first, last], last)).toBe(last)
    expect(visiblePortalFallback([first], last)).toBe(first)
  })

  it("returns null when no visible popup exists", () => {
    const draft = popup({ id: "draft-1", status: "draft" })

    expect(visiblePortalFallback([], draft)).toBeNull()
  })
})
