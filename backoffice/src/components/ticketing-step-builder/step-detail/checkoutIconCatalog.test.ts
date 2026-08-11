import {
  CHECKOUT_ICON_CATALOG,
  CHECKOUT_ICON_GROUPS,
  getRegistryIcon,
  resolveStepIcon,
} from "@edgeos/shared-form-ui"
import { describe, expect, it } from "vitest"

/** Slugs that resolved before the picker existed and are intentionally kept
 *  out of the catalog as aliases. Steps already saved with these must keep
 *  rendering the icon their operator chose. */
const LEGACY_ALIASES = [
  "profile",
  "housing",
  "movie",
  "photo",
  "gallery",
  "faq",
  "checkout",
  "fork",
  "meal",
  "meal-plan",
  "chef",
]

describe("checkout icon catalog", () => {
  it("offers a curated set of at least 40 icons", () => {
    expect(CHECKOUT_ICON_CATALOG.length).toBeGreaterThanOrEqual(40)
  })

  it("has no duplicate slugs", () => {
    const slugs = CHECKOUT_ICON_CATALOG.map((entry) => entry.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it("keeps every slug kebab-case and within the 32-char column", () => {
    for (const entry of CHECKOUT_ICON_CATALOG) {
      expect(entry.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(entry.slug.length).toBeLessThanOrEqual(32)
    }
  })

  it("gives every entry a defined component, label and known group", () => {
    for (const entry of CHECKOUT_ICON_CATALOG) {
      expect(entry.Icon, entry.slug).toBeTruthy()
      expect(entry.label.length, entry.slug).toBeGreaterThan(0)
      expect(CHECKOUT_ICON_GROUPS, entry.slug).toContain(entry.group)
    }
  })

  it("resolves every catalog slug to that same component", () => {
    for (const entry of CHECKOUT_ICON_CATALOG) {
      expect(getRegistryIcon(entry.slug), entry.slug).toBe(entry.Icon)
    }
  })

  it("still resolves legacy slugs kept out of the catalog", () => {
    const catalogSlugs = new Set(
      CHECKOUT_ICON_CATALOG.map((entry) => entry.slug),
    )
    for (const legacy of LEGACY_ALIASES) {
      expect(catalogSlugs.has(legacy), legacy).toBe(false)
      expect(getRegistryIcon(legacy), legacy).not.toBeNull()
    }
  })

  it("normalises slug case and surrounding whitespace", () => {
    expect(getRegistryIcon("  TICKET ")).toBe(getRegistryIcon("ticket"))
  })

  it("returns null for a literal emoji so callers can render it as text", () => {
    expect(getRegistryIcon("🎟️")).toBeNull()
    expect(getRegistryIcon("")).toBeNull()
    expect(getRegistryIcon(null)).toBeNull()
  })

  it("falls back to the template, then the step type", () => {
    expect(resolveStepIcon({ emoji: "🎉", template: "faqs" })).toBe(
      getRegistryIcon("help"),
    )
    expect(resolveStepIcon({ emoji: null, stepType: "buyer" })).toBe(
      getRegistryIcon("user"),
    )
    expect(resolveStepIcon({})).toBe(getRegistryIcon("ticket"))
  })

  it("lets an explicit slug win over the template default", () => {
    expect(resolveStepIcon({ emoji: "mushroom", template: "faqs" })).toBe(
      getRegistryIcon("mushroom"),
    )
  })
})
