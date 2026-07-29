import { describe, expect, it } from "vitest"
import type { CheckoutStep } from "../types/checkout"
import {
  canProceedToStep,
  isStepComplete,
  nextStep,
  previousStep,
} from "./navigation"

const STEPS: CheckoutStep[] = ["passes", "buyer", "confirm"]

describe("nextStep / previousStep", () => {
  it("advances and retreats within bounds", () => {
    expect(nextStep(STEPS, "passes")).toBe("buyer")
    expect(previousStep(STEPS, "buyer")).toBe("passes")
  })

  it("clamps at the ends and on unknown steps", () => {
    expect(nextStep(STEPS, "confirm")).toBe("confirm")
    expect(previousStep(STEPS, "passes")).toBe("passes")
    expect(nextStep(STEPS, "merch")).toBe("merch")
    expect(previousStep(STEPS, "merch")).toBe("merch")
  })
})

describe("canProceedToStep", () => {
  const base = {
    availableSteps: STEPS,
    selectedPassesCount: 0,
    dynamicItemsCount: 0,
    isEditing: false,
  }

  it("allows the first step with nothing selected", () => {
    expect(canProceedToStep("passes", base)).toBe(true)
  })

  it("blocks later steps until something is selected", () => {
    expect(canProceedToStep("buyer", base)).toBe(false)
    expect(canProceedToStep("buyer", { ...base, selectedPassesCount: 1 })).toBe(true)
    expect(canProceedToStep("buyer", { ...base, dynamicItemsCount: 1 })).toBe(true)
  })

  it("blocks steps past buyer until buyer info is complete", () => {
    const withPass = { ...base, selectedPassesCount: 1 }
    expect(canProceedToStep("confirm", { ...withPass, buyerInfoComplete: false })).toBe(false)
    expect(canProceedToStep("confirm", { ...withPass, buyerInfoComplete: true })).toBe(true)
  })

  it("when editing, only requires a selected pass", () => {
    expect(canProceedToStep("confirm", { ...base, isEditing: true })).toBe(false)
    expect(
      canProceedToStep("confirm", { ...base, isEditing: true, selectedPassesCount: 1 }),
    ).toBe(true)
  })
})

describe("isStepComplete", () => {
  it("is true for ticket steps once a pass is selected", () => {
    expect(isStepComplete("passes", 1)).toBe(true)
    expect(isStepComplete("tickets", 1)).toBe(true)
    expect(isStepComplete("passes", 0)).toBe(false)
  })

  it("is false for non-ticket steps", () => {
    expect(isStepComplete("housing", 5)).toBe(false)
    expect(isStepComplete("confirm", 5)).toBe(false)
  })
})
