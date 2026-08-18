import { getRegistryIcon, resolveStepIcon } from "@edgeos/shared-form-ui"
import { describe, expect, it } from "vitest"

import { resolveStepCardIcon } from "./SortableStepCard"

describe("resolveStepCardIcon", () => {
  it("resolves a catalog slug to its registry icon", () => {
    const result = resolveStepCardIcon({
      step_type: "buyer",
      template: "buyer-form",
      emoji: "mushroom",
    })

    expect(result.kind).toBe("registry")
    expect(result.kind === "registry" && result.Icon).toBe(
      getRegistryIcon("mushroom"),
    )
  })

  it("resolves a literal emoji to render as text, not an icon", () => {
    const result = resolveStepCardIcon({
      step_type: "buyer",
      template: "buyer-form",
      emoji: "🎉",
    })

    expect(result).toEqual({ kind: "literal", emoji: "🎉" })
  })

  it("falls back to the step-type/template default when emoji is empty", () => {
    const result = resolveStepCardIcon({
      step_type: "buyer",
      template: "buyer-form",
      emoji: "",
    })

    expect(result.kind).toBe("default")
    expect(result.kind === "default" && result.Icon).toBe(
      resolveStepIcon({ stepType: "buyer", template: "buyer-form" }),
    )
  })

  it("falls back to the default when emoji is null", () => {
    const result = resolveStepCardIcon({
      step_type: "confirm",
      template: null,
      emoji: null,
    })

    expect(result.kind).toBe("default")
    expect(result.kind === "default" && result.Icon).toBe(
      resolveStepIcon({ stepType: "confirm", template: null }),
    )
  })

  it("falls back to the default when emoji is whitespace-only", () => {
    const result = resolveStepCardIcon({
      step_type: "confirm",
      template: null,
      emoji: "   ",
    })

    expect(result.kind).toBe("default")
  })

  it("treats an unrecognised string as a literal emoji, not a silently-dropped slug", () => {
    const result = resolveStepCardIcon({
      step_type: "buyer",
      template: "buyer-form",
      emoji: "not-a-real-slug",
    })

    expect(result).toEqual({ kind: "literal", emoji: "not-a-real-slug" })
  })
})
