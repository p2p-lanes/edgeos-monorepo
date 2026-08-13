import { describe, expect, it } from "vitest"
import type { CheckoutRuntimeProduct, TicketingStep } from "../types/api"
import {
  buildProductsByStepId,
  deriveAvailableSteps,
  isStepVisible,
  resolveStepProducts,
  toCheckoutStep,
} from "./derive"

function step(over: Partial<TicketingStep> & { step_type: string }): TicketingStep {
  return {
    id: over.id ?? `${over.step_type}-1`,
    tenant_id: "t",
    popup_id: "p",
    title: over.step_type,
    ...over,
  }
}

function product(
  over: Partial<CheckoutRuntimeProduct> & { id: string },
): CheckoutRuntimeProduct {
  return {
    tenant_id: "t",
    popup_id: "p",
    name: over.id,
    slug: over.id,
    price: "10.00",
    category: "ticket",
    ...over,
  }
}

describe("toCheckoutStep", () => {
  it("maps tickets → passes and passes others through", () => {
    expect(toCheckoutStep("tickets")).toBe("passes")
    expect(toCheckoutStep("buyer")).toBe("buyer")
    expect(toCheckoutStep("housing")).toBe("housing")
    expect(toCheckoutStep("confirm")).toBe("confirm")
    expect(toCheckoutStep("merch")).toBe("merch")
    expect(toCheckoutStep("patron")).toBe("patron")
  })
})

describe("resolveStepProducts", () => {
  const products = [
    product({ id: "a", category: "Housing", is_active: true }),
    product({ id: "b", category: "housing", is_active: true }),
    product({ id: "c", category: "housing", is_active: false }),
    product({ id: "d", category: "merch", is_active: true }),
  ]

  it("matches active products by case-insensitive category", () => {
    const s = step({ step_type: "housing", product_category: "housing" })
    expect(resolveStepProducts(s, products).map((p) => p.id)).toEqual(["a", "b"])
  })

  it("returns [] for content-only templates", () => {
    const s = step({ step_type: "housing", product_category: "housing", template: "faqs" })
    expect(resolveStepProducts(s, products)).toEqual([])
  })

  it("returns [] for confirm and for steps without a category", () => {
    expect(resolveStepProducts(step({ step_type: "confirm" }), products)).toEqual([])
    expect(resolveStepProducts(step({ step_type: "housing" }), products)).toEqual([])
  })
})

describe("isStepVisible", () => {
  it("hides disabled steps", () => {
    expect(isStepVisible(step({ step_type: "housing", is_enabled: false }), [])).toBe(false)
  })

  it("shows structural steps with no products", () => {
    expect(isStepVisible(step({ step_type: "confirm" }), [])).toBe(true)
    expect(isStepVisible(step({ step_type: "buyer" }), [])).toBe(true)
    expect(isStepVisible(step({ step_type: "tickets" }), [])).toBe(true)
  })

  it("shows content-only template steps with no products", () => {
    expect(isStepVisible(step({ step_type: "housing", template: "hero" }), [])).toBe(true)
  })

  it("shows product-bearing steps only when they have products", () => {
    const s = step({ step_type: "housing", product_category: "housing" })
    expect(isStepVisible(s, [])).toBe(false)
    expect(isStepVisible(s, [product({ id: "a" })])).toBe(true)
  })
})

describe("deriveAvailableSteps", () => {
  it("falls back to [passes, confirm] with no config", () => {
    expect(deriveAvailableSteps([], new Map())).toEqual(["passes", "confirm"])
  })

  it("builds the ordered visible step list", () => {
    const steps = [
      step({ id: "s1", step_type: "tickets" }),
      step({ id: "s2", step_type: "housing", product_category: "housing" }),
      step({ id: "s3", step_type: "merch", product_category: "merch" }),
      step({ id: "s4", step_type: "buyer" }),
      step({ id: "s5", step_type: "confirm" }),
    ]
    const products = [product({ id: "h", category: "housing" })]
    const map = buildProductsByStepId(steps, products)

    // housing has a product (visible); merch has none (hidden)
    expect(deriveAvailableSteps(steps, map)).toEqual([
      "passes",
      "housing",
      "buyer",
      "confirm",
    ])
  })
})
