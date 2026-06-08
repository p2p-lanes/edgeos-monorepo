import { describe, expect, it } from "vitest"
import { deriveProductState } from "@/lib/product-state"
import {
  mealPlanProductIds,
  parseMealPlanTemplateConfig,
  weekdayDates,
} from "./mealPlanShared"

describe("weekdayDates", () => {
  it("returns only Mon–Fri ISO dates within the inclusive coverage range", () => {
    // 2026-06-01 (Mon) .. 2026-06-07 (Sun) → Mon..Fri only.
    const dates = weekdayDates({
      coverageStart: "2026-06-01",
      coverageEnd: "2026-06-07",
    })
    expect(dates).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ])
  })

  it("excludes weekend endpoints", () => {
    // 2026-06-06 (Sat) .. 2026-06-07 (Sun) → empty.
    expect(
      weekdayDates({ coverageStart: "2026-06-06", coverageEnd: "2026-06-07" }),
    ).toEqual([])
  })

  it("returns a single day when start == end on a weekday", () => {
    expect(
      weekdayDates({ coverageStart: "2026-06-03", coverageEnd: "2026-06-03" }),
    ).toEqual(["2026-06-03"])
  })
})

describe("mealPlanProductIds", () => {
  it("collects every product_id across sections", () => {
    const config = {
      sections: [
        { products: [{ product_id: "a" }, { product_id: "b" }] },
        { products: [{ product_id: "c" }] },
      ],
    }
    expect(mealPlanProductIds(config)).toEqual(new Set(["a", "b", "c"]))
  })

  it("returns an empty set for null/empty config", () => {
    expect(mealPlanProductIds(null).size).toBe(0)
    expect(mealPlanProductIds({}).size).toBe(0)
    expect(mealPlanProductIds({ sections: [] }).size).toBe(0)
  })
})

describe("parseMealPlanTemplateConfig", () => {
  const products = [
    { id: "wk1", name: "Week 1", price: 75 },
    { id: "wk2", name: "Week 2", price: 75 },
  ]
  const config = {
    sections: [
      {
        key: "weekly",
        label: "Weekly",
        order: 0,
        products: [
          {
            product_id: "wk1",
            coverage_start: "2026-06-01",
            coverage_end: "2026-06-05",
            menu_options: [
              { key: "veggie", title: "Veggie", icon: "🥗" },
              { key: "chicken", title: "Chicken" },
            ],
          },
        ],
      },
    ],
  }

  it("builds MealPlanProduct entries matched to the product list", () => {
    const { sections } = parseMealPlanTemplateConfig(config, products)
    expect(sections).toHaveLength(1)
    const [wk] = sections[0].products
    expect(wk.id).toBe("wk1")
    expect(wk.weekLabel).toBe("Week 1")
    expect(wk.coverageStart).toBe("2026-06-01")
    expect(wk.menuOptions.map((o) => o.key)).toEqual(["veggie", "chicken"])
    // Default icon is applied when missing.
    expect(wk.menuOptions[1].icon).toBe("🍽️")
  })

  it("skips section products with no matching product", () => {
    const { sections } = parseMealPlanTemplateConfig(config, [
      { id: "other", name: "Other" },
    ])
    expect(sections[0].products).toHaveLength(0)
  })

  it("skips section products missing coverage dates", () => {
    const broken = {
      sections: [{ products: [{ product_id: "wk1", menu_options: [] }] }],
    }
    const { sections } = parseMealPlanTemplateConfig(broken, products)
    expect(sections[0].products).toHaveLength(0)
  })
})

describe("read-only week gating (deriveProductState)", () => {
  const base = {
    sale_starts_at: null,
    total_stock_remaining: null,
    total_stock_cap: null,
  }

  it("locks a week whose sale_ends_at is in the past", () => {
    expect(
      deriveProductState({ ...base, sale_ends_at: "2000-01-01T00:00:00Z" }),
    ).toBe("ended")
  })

  it("keeps a week editable when sale_ends_at is in the future", () => {
    expect(
      deriveProductState({ ...base, sale_ends_at: "2999-01-01T00:00:00Z" }),
    ).toBe("on_sale")
  })

  it("treats a NULL sale_ends_at as editable (on_sale)", () => {
    expect(deriveProductState({ ...base, sale_ends_at: null })).toBe("on_sale")
  })

  // VariantMealPlanSelect disables every non-`on_sale` state (not just ended),
  // matching VariantTicketSelect and the backend payment gate. These guard the
  // symmetric upcoming / sold-out variants of the same checkout failure.
  it("marks a week whose sale_starts_at is in the future as upcoming", () => {
    expect(
      deriveProductState({
        ...base,
        sale_ends_at: null,
        sale_starts_at: "2999-01-01T00:00:00Z",
      }),
    ).toBe("upcoming")
  })

  it("marks a week with no remaining stock as sold_out", () => {
    expect(
      deriveProductState({
        ...base,
        sale_ends_at: null,
        total_stock_cap: 10,
        total_stock_remaining: 0,
      }),
    ).toBe("sold_out")
  })
})
