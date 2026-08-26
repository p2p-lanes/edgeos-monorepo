/**
 * Tests for the tour content.
 *
 * Covers:
 * - the gathering act appears only when a gathering is selected
 * - every anchor/clickBefore a step references is a declared anchor, so a
 *   renamed `data-tour` attribute fails here instead of silently skipping a
 *   step in production
 * - step ids are unique (they are React keys) and the tour opens and closes
 *   on unanchored steps
 * - every declared anchor is actually planted in the components that are
 *   supposed to carry it
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { buildTourSteps, TOUR_ANCHOR_IDS } from "./tourSteps"

const POPUP_ID = "11111111-2222-3333-4444-555555555555"

/** Components that carry `data-tour` attributes for the tour to aim at. */
const ANCHOR_HOST_FILES = [
  "../Sidebar/AppSidebar.tsx",
  "../forms/PopupForm.tsx",
]

describe("buildTourSteps", () => {
  it("walks the gathering form when a gathering is selected", () => {
    const ids = buildTourSteps({ popupId: POPUP_ID }).map((s) => s.id)

    expect(ids).toContain("gathering-overview")
    expect(ids).toContain("gathering-general")
    expect(ids).toContain("gathering-commerce")
    expect(ids).toContain("gathering-features")
  })

  it("drops the gathering act when there is no gathering to point at", () => {
    const ids = buildTourSteps({ popupId: null }).map((s) => s.id)

    expect(ids.some((id) => id.startsWith("gathering-"))).toBe(false)
    // The rest of the tour still stands on its own.
    expect(ids).toContain("welcome")
    expect(ids).toContain("attendees")
    expect(ids).toContain("finish")
  })

  it("points the gathering steps at the selected gathering", () => {
    const overview = buildTourSteps({ popupId: POPUP_ID }).find(
      (s) => s.id === "gathering-overview",
    )

    expect(overview?.route).toEqual({
      to: "/popups/$id/edit",
      params: { id: POPUP_ID },
    })
  })

  it("covers every section the tour promises to explain", () => {
    const ids = buildTourSteps({ popupId: POPUP_ID }).map((s) => s.id)

    for (const section of [
      "products",
      "ticketing-steps",
      "applications",
      "attendees",
      "payments",
      "coupons",
    ]) {
      expect(ids).toContain(section)
    }
  })

  it("only references declared anchors", () => {
    const declared = new Set<string>(TOUR_ANCHOR_IDS)

    for (const step of buildTourSteps({ popupId: POPUP_ID })) {
      if (step.anchor) expect(declared).toContain(step.anchor)
      if (step.clickBefore) expect(declared).toContain(step.clickBefore)
    }
  })

  it("keeps em dashes out of the copy", () => {
    // Chole asked for commas and full stops instead; this stops one drifting
    // back in with a future step.
    for (const step of buildTourSteps({ popupId: POPUP_ID })) {
      expect(step.title).not.toContain("—")
      expect(step.body).not.toContain("—")
    }
  })

  it("gives every step a unique id and non-empty copy", () => {
    const steps = buildTourSteps({ popupId: POPUP_ID })
    const ids = steps.map((s) => s.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const step of steps) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(0)
    }
  })

  it("opens and closes on centered steps", () => {
    const steps = buildTourSteps({ popupId: POPUP_ID })

    expect(steps[0].anchor).toBeUndefined()
    expect(steps[steps.length - 1].anchor).toBeUndefined()
  })
})

describe("tour anchors", () => {
  // Without this, dropping a `tourId` from the sidebar would leave the suite
  // green while the matching step silently auto-skipped in production. Source
  // text rather than a render: the hosts pull in the router, workspace context
  // and a dozen queries, and this only needs to know the attribute is there.
  it("are planted in the components that carry them", () => {
    const sources = ANCHOR_HOST_FILES.map((rel) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"),
    ).join("\n")

    for (const anchorId of TOUR_ANCHOR_IDS) {
      expect(
        sources.includes(`"${anchorId}"`),
        `anchor "${anchorId}" is declared but no component plants it — the tour would skip that step`,
      ).toBe(true)
    }
  })
})
