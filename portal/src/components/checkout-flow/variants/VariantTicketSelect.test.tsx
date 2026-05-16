import { describe, expect, it } from "vitest"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import {
  buildSectionGroups,
  isSectionVisibleForApp,
} from "./VariantTicketSelect"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(id: string): ProductsPass {
  return {
    id,
    name: `Product ${id}`,
    category: "ticket",
    price: 100,
    popup_id: "popup-1",
    tenant_id: "tenant-1",
    is_active: true,
    requires_check_in: false,
  } as unknown as ProductsPass
}

function makeAttendee(
  category: string,
  products: ProductsPass[],
): AttendeePassState {
  return {
    id: "attendee-1",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    name: "Test Attendee",
    category,
    products,
  } as AttendeePassState
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSectionGroups — attendee_categories filtering", () => {
  const prodSpouse = makeProduct("prod-spouse")
  const prodAll = makeProduct("prod-all")

  it("excludes spouse-only section for main attendee, includes it for spouse", () => {
    const sections = [
      {
        key: "spouse-only",
        label: "Spouse Section",
        order: 0,
        product_ids: ["prod-spouse"],
        attendee_categories: ["spouse"],
      },
    ]

    const mainResult = buildSectionGroups(
      makeAttendee("main", [prodSpouse]),
      sections,
    )
    expect(mainResult).toHaveLength(0)

    const spouseResult = buildSectionGroups(
      makeAttendee("spouse", [prodSpouse]),
      sections,
    )
    expect(spouseResult).toHaveLength(1)
    expect(spouseResult[0].section.key).toBe("spouse-only")
  })

  it("[spouse, kid] section: spouse included, kid included, main excluded", () => {
    const sections = [
      {
        key: "spouse-kid",
        label: "Spouse & Kid",
        order: 0,
        product_ids: ["prod-spouse"],
        attendee_categories: ["spouse", "kid"],
      },
    ]

    expect(
      buildSectionGroups(makeAttendee("spouse", [prodSpouse]), sections),
    ).toHaveLength(1)
    expect(
      buildSectionGroups(makeAttendee("kid", [prodSpouse]), sections),
    ).toHaveLength(1)
    expect(
      buildSectionGroups(makeAttendee("main", [prodSpouse]), sections),
    ).toHaveLength(0)
  })

  it("null attendee_categories: visible to main, spouse, kid, teen, baby", () => {
    const sections = [
      {
        key: "all",
        label: "All",
        order: 0,
        product_ids: ["prod-all"],
        attendee_categories: null,
      },
    ]

    for (const cat of ["main", "spouse", "kid", "teen", "baby"]) {
      const result = buildSectionGroups(makeAttendee(cat, [prodAll]), sections)
      expect(result).toHaveLength(1)
    }
  })

  it("kid-gated section: teen attendee is included via normalisation", () => {
    const sections = [
      {
        key: "kid-only",
        label: "Kid Section",
        order: 0,
        product_ids: ["prod-spouse"],
        attendee_categories: ["kid"],
      },
    ]

    const result = buildSectionGroups(
      makeAttendee("teen", [prodSpouse]),
      sections,
    )
    expect(result).toHaveLength(1)
  })

  it("kid-gated section: baby attendee is included via normalisation", () => {
    const sections = [
      {
        key: "kid-only",
        label: "Kid Section",
        order: 0,
        product_ids: ["prod-spouse"],
        attendee_categories: ["kid"],
      },
    ]

    const result = buildSectionGroups(
      makeAttendee("baby", [prodSpouse]),
      sections,
    )
    expect(result).toHaveLength(1)
  })

  it("empty attendee_categories list: section hidden for all attendees", () => {
    const sections = [
      {
        key: "hidden",
        label: "Hidden Section",
        order: 0,
        product_ids: ["prod-spouse"],
        attendee_categories: [],
      },
    ]

    for (const cat of ["main", "spouse", "kid", "teen", "baby"]) {
      const result = buildSectionGroups(
        makeAttendee(cat, [prodSpouse]),
        sections,
      )
      expect(result).toHaveLength(0)
    }
  })

  it("section without visible_if passes through pre-filter regardless of customFields", () => {
    // Pre-filter consumers (`VariantTicketSelect`, `LegacySectionLayout`) call
    // isSectionVisibleForApp first. Sections without a condition are always kept.
    const section = {
      key: "no-cond",
      label: "Always",
      order: 0,
      product_ids: [],
    }
    expect(isSectionVisibleForApp(section, null)).toBe(true)
    expect(isSectionVisibleForApp(section, {})).toBe(true)
    expect(isSectionVisibleForApp(section, { foo: "bar" })).toBe(true)
  })

  it("all four layouts share the filter via buildSectionGroups as single chokepoint", () => {
    // This test verifies the structural assumption: buildSectionGroups is the
    // single filter chokepoint. All four layout variants (stacked, tabs, compact,
    // accordion) consume it — the grep gate (G.1) locks structural coverage.
    // Here we verify the filter itself works correctly for a representative case.
    const spouseSection = {
      key: "spouse-only",
      label: "Spouse",
      order: 0,
      product_ids: ["prod-spouse"],
      attendee_categories: ["spouse"] as string[],
    }
    const ungatedSection = {
      key: "all",
      label: "All",
      order: 1,
      product_ids: ["prod-all"],
      attendee_categories: null,
    }

    const result = buildSectionGroups(
      makeAttendee("main", [prodSpouse, prodAll]),
      [spouseSection, ungatedSection],
    )

    // main attendee sees only the ungated section
    expect(result).toHaveLength(1)
    expect(result[0].section.key).toBe("all")
  })
})

describe("isSectionVisibleForApp — visible_if gating", () => {
  const baseSection = {
    key: "locals",
    label: "Locals",
    order: 0,
    product_ids: ["p1"],
  }

  it("matches single string value", () => {
    const section = {
      ...baseSection,
      visible_if: { field_id: "local_resident", value: "Yes" },
    }
    expect(isSectionVisibleForApp(section, { local_resident: "Yes" })).toBe(
      true,
    )
    expect(isSectionVisibleForApp(section, { local_resident: "No" })).toBe(
      false,
    )
  })

  it("matches when answer is in an array of accepted values", () => {
    const section = {
      ...baseSection,
      visible_if: { field_id: "tier", value: ["Yes", "Maybe"] },
    }
    expect(isSectionVisibleForApp(section, { tier: "Yes" })).toBe(true)
    expect(isSectionVisibleForApp(section, { tier: "Maybe" })).toBe(true)
    expect(isSectionVisibleForApp(section, { tier: "No" })).toBe(false)
  })

  it("hides section when the field has no answer for the application", () => {
    const section = {
      ...baseSection,
      visible_if: { field_id: "local_resident", value: "Yes" },
    }
    expect(isSectionVisibleForApp(section, { unrelated: "x" })).toBe(false)
  })

  it("treats missing custom_fields as no-gate (open-ticketing fallback)", () => {
    // Before the application form is filled (open-ticketing flow), the gate
    // is short-circuited so sections still render.
    const section = {
      ...baseSection,
      visible_if: { field_id: "local_resident", value: "Yes" },
    }
    expect(isSectionVisibleForApp(section, null)).toBe(true)
    expect(isSectionVisibleForApp(section, undefined)).toBe(true)
  })

  it("ignores malformed visible_if (no field_id) and shows section", () => {
    const section = {
      ...baseSection,
      visible_if: { field_id: "", value: "Yes" },
    }
    expect(isSectionVisibleForApp(section, { local_resident: "Yes" })).toBe(
      true,
    )
  })
})
