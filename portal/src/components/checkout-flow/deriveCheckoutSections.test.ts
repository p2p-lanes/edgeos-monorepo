import { describe, expect, it } from "vitest"
import type { TicketingStepPublic } from "@/client"
import { deriveCheckoutSections } from "./deriveCheckoutSections"

function config(over: Partial<TicketingStepPublic>): TicketingStepPublic {
  return {
    id: over.id ?? "cfg",
    step_type: over.step_type ?? "passes",
    title: over.title ?? "T",
    show_in_navbar: over.show_in_navbar ?? true,
    ...over,
  } as TicketingStepPublic
}

describe("deriveCheckoutSections", () => {
  it("drops the success step and defaults labels", () => {
    const sections = deriveCheckoutSections(
      ["passes", "confirm", "success"],
      [],
    )
    expect(sections.map((s) => s.id)).toEqual(["passes", "confirm"])
    expect(sections[0].label).toBe("Select Your Passes")
    expect(sections[1].label).toBe("Review & Confirm")
  })

  it("consumes one matching config per step and prefers its title", () => {
    const sections = deriveCheckoutSections(
      ["passes"],
      [config({ id: "c1", step_type: "tickets", title: "Entradas" })],
    )
    expect(sections[0].config?.id).toBe("c1")
    expect(sections[0].label).toBe("Entradas")
  })

  it("disambiguates duplicate step types with a suffix", () => {
    const sections = deriveCheckoutSections(["housing", "housing"], [])
    expect(sections.map((s) => s.id)).toEqual(["housing", "housing-2"])
  })

  it("carries show_in_navbar through (default true)", () => {
    const sections = deriveCheckoutSections(
      ["passes"],
      [config({ id: "c1", step_type: "passes", show_in_navbar: false })],
    )
    expect(sections[0].showInNavbar).toBe(false)
  })
})
