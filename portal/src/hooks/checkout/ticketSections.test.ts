import { describe, expect, it } from "vitest"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import {
  buildSectionGroups,
  isSectionVisibleForApp,
  parseSections,
} from "./ticketSections"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(
  id: string,
  overrides: Partial<ProductsPass> = {},
): ProductsPass {
  return {
    id,
    name: id,
    slug: id,
    popup_id: "popup-1",
    tenant_id: "tenant-1",
    attendee_category_id: null,
    category: "ticket",
    duration_type: "week",
    is_active: true,
    price: 100,
    original_price: 100,
    quantity: 1,
    selected: false,
    purchased: false,
    max_per_order: 1,
    compare_price: null,
    ...overrides,
  } as ProductsPass
}

function makeAttendee(
  id: string,
  products: ProductsPass[],
  overrides: Partial<AttendeePassState> = {},
): AttendeePassState {
  return {
    id,
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    human_id: "human-1",
    application_id: null,
    name: id,
    category: "main",
    category_id: null,
    email: `${id}@example.com`,
    gender: null,
    poap_url: null,
    created_at: null,
    updated_at: null,
    products,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseSections
// ---------------------------------------------------------------------------

describe("parseSections", () => {
  it("returns empty array when templateConfig is null", () => {
    expect(parseSections(null)).toEqual([])
  })

  it("returns empty array when templateConfig has no sections field", () => {
    expect(parseSections({})).toEqual([])
  })

  it("returns empty array when sections is an empty array", () => {
    expect(parseSections({ sections: [] })).toEqual([])
  })

  it("returns sections sorted by order ascending", () => {
    const cfg = {
      sections: [
        { key: "b", label: "B", order: 2, product_ids: ["p2"] },
        { key: "a", label: "A", order: 1, product_ids: ["p1"] },
        { key: "c", label: "C", order: 3, product_ids: ["p3"] },
      ],
    }
    const result = parseSections(cfg)
    expect(result.map((s) => s.key)).toEqual(["a", "b", "c"])
  })

  it("preserves all section fields including optional ones", () => {
    const cfg = {
      sections: [
        {
          key: "s1",
          label: "Section 1",
          order: 1,
          product_ids: ["p1"],
          attendee_categories: ["cat-a"],
          visible_if: { field_id: "role", value: "speaker" },
        },
      ],
    }
    const result = parseSections(cfg)
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe("s1")
    expect(result[0].attendee_categories).toEqual(["cat-a"])
    expect(result[0].visible_if).toEqual({ field_id: "role", value: "speaker" })
  })

  it("handles sections that are not a valid array by returning empty", () => {
    expect(parseSections({ sections: "bad" as unknown as unknown[] })).toEqual(
      [],
    )
  })
})

// ---------------------------------------------------------------------------
// isSectionVisibleForApp
// ---------------------------------------------------------------------------

describe("isSectionVisibleForApp", () => {
  const sectionNoGate = {
    key: "s1",
    label: "S1",
    order: 1,
    product_ids: [],
    visible_if: null,
  }

  const sectionGated = {
    key: "s2",
    label: "S2",
    order: 2,
    product_ids: [],
    visible_if: { field_id: "role", value: "speaker" },
  }

  const sectionMultiValue = {
    key: "s3",
    label: "S3",
    order: 3,
    product_ids: [],
    visible_if: { field_id: "role", value: ["speaker", "organizer"] },
  }

  it("always visible when no visible_if condition", () => {
    expect(isSectionVisibleForApp(sectionNoGate, null)).toBe(true)
    expect(isSectionVisibleForApp(sectionNoGate, { role: "attendee" })).toBe(
      true,
    )
  })

  it("visible when customFields is null (no application, open-ticketing fallback)", () => {
    expect(isSectionVisibleForApp(sectionGated, null)).toBe(true)
  })

  it("visible when customFields is undefined", () => {
    expect(isSectionVisibleForApp(sectionGated, undefined)).toBe(true)
  })

  it("visible when the gating field is absent from customFields", () => {
    expect(isSectionVisibleForApp(sectionGated, { other_field: "value" })).toBe(
      true,
    )
  })

  it("visible when the gating field is empty string", () => {
    expect(isSectionVisibleForApp(sectionGated, { role: "" })).toBe(true)
  })

  it("visible when the gating field is null", () => {
    expect(isSectionVisibleForApp(sectionGated, { role: null })).toBe(true)
  })

  it("visible when the field value matches the condition (single string)", () => {
    expect(isSectionVisibleForApp(sectionGated, { role: "speaker" })).toBe(true)
  })

  it("not visible when the field value does not match (single string)", () => {
    expect(isSectionVisibleForApp(sectionGated, { role: "attendee" })).toBe(
      false,
    )
  })

  it("visible when field value matches one of the expected values (array)", () => {
    expect(isSectionVisibleForApp(sectionMultiValue, { role: "speaker" })).toBe(
      true,
    )
    expect(
      isSectionVisibleForApp(sectionMultiValue, { role: "organizer" }),
    ).toBe(true)
  })

  it("not visible when field value matches none of the expected values (array)", () => {
    expect(
      isSectionVisibleForApp(sectionMultiValue, { role: "attendee" }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildSectionGroups
// ---------------------------------------------------------------------------

describe("buildSectionGroups", () => {
  const pMonth = makeProduct("p-month", { duration_type: "month" })
  const pWeek1 = makeProduct("p-week1", { duration_type: "week" })
  const pWeek2 = makeProduct("p-week2", { duration_type: "week" })
  const pDay = makeProduct("p-day", { duration_type: "day" })

  const attendeeA = makeAttendee("a", [pMonth, pWeek1, pWeek2, pDay], {
    category_id: "cat-main",
  })

  const sections = [
    {
      key: "full-month",
      label: "Full / Month",
      order: 1,
      product_ids: ["p-month"],
      attendee_categories: null,
    },
    {
      key: "weekly",
      label: "Weekly",
      order: 2,
      product_ids: ["p-week1", "p-week2"],
      attendee_categories: null,
    },
    {
      key: "daily",
      label: "Daily",
      order: 3,
      product_ids: ["p-day"],
      attendee_categories: null,
    },
  ]

  it("maps product_ids to actual products from the attendee", () => {
    const groups = buildSectionGroups(attendeeA, sections)
    expect(groups).toHaveLength(3)
    expect(groups[0].section.key).toBe("full-month")
    expect(groups[0].products).toHaveLength(1)
    expect(groups[0].products[0].id).toBe("p-month")
  })

  it("returns multiple products per section", () => {
    const groups = buildSectionGroups(attendeeA, sections)
    const weekly = groups.find((g) => g.section.key === "weekly")
    expect(weekly?.products).toHaveLength(2)
    expect(weekly?.products.map((p) => p.id)).toEqual(["p-week1", "p-week2"])
  })

  it("excludes sections whose products are not in the attendee's product list", () => {
    const attendeeNoDay = makeAttendee("b", [pMonth, pWeek1])
    const groups = buildSectionGroups(attendeeNoDay, sections)
    const daily = groups.find((g) => g.section.key === "daily")
    expect(daily).toBeUndefined()
  })

  it("filters sections gated to specific attendee_categories — shows when category matches", () => {
    const restrictedSections = [
      {
        key: "vip",
        label: "VIP",
        order: 1,
        product_ids: ["p-month"],
        attendee_categories: ["cat-main"],
      },
    ]
    const groups = buildSectionGroups(attendeeA, restrictedSections)
    expect(groups).toHaveLength(1)
  })

  it("filters sections gated to specific attendee_categories — hides when category does not match", () => {
    const restrictedSections = [
      {
        key: "vip",
        label: "VIP",
        order: 1,
        product_ids: ["p-month"],
        attendee_categories: ["cat-other"],
      },
    ]
    const groups = buildSectionGroups(attendeeA, restrictedSections)
    expect(groups).toHaveLength(0)
  })

  it("returns duration-type groups as fallback when sections is empty", () => {
    const groups = buildSectionGroups(attendeeA, [])
    // fallback groups by duration: month, week, day for main attendee
    expect(groups.length).toBeGreaterThan(0)
    const keys = groups.map((g) => g.section.key)
    expect(keys).toContain("week")
    expect(keys).toContain("day")
  })

  it("excludes patreon products regardless of section config", () => {
    const pPatreon = makeProduct("p-patreon", { category: "patreon" })
    const attendeeWithPatreon = makeAttendee("c", [pMonth, pPatreon])
    const sectionWithPatreon = [
      {
        key: "all",
        label: "All",
        order: 1,
        product_ids: ["p-month", "p-patreon"],
        attendee_categories: null,
      },
    ]
    const groups = buildSectionGroups(attendeeWithPatreon, sectionWithPatreon)
    const ids = groups.flatMap((g) => g.products.map((p) => p.id))
    expect(ids).not.toContain("p-patreon")
  })

  it("multi-attendee scenario — each attendee scoped correctly", () => {
    const pSpecial = makeProduct("p-special", { duration_type: "full" })
    const attendeeB = makeAttendee("b2", [pSpecial], { category_id: "cat-vip" })

    const mixedSections = [
      {
        key: "s-main",
        label: "Main",
        order: 1,
        product_ids: ["p-month"],
        attendee_categories: ["cat-main"],
      },
      {
        key: "s-vip",
        label: "VIP",
        order: 2,
        product_ids: ["p-special"],
        attendee_categories: ["cat-vip"],
      },
    ]

    const groupsA = buildSectionGroups(attendeeA, mixedSections)
    const groupsB = buildSectionGroups(attendeeB, mixedSections)

    expect(groupsA.map((g) => g.section.key)).toEqual(["s-main"])
    expect(groupsB.map((g) => g.section.key)).toEqual(["s-vip"])
  })
})
