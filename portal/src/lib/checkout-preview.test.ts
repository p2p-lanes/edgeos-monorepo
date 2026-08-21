import { describe, expect, it } from "vitest"
import type { CheckoutRuntimeResponse, TicketingStepPublic } from "@/client"
import {
  applyStepDraft,
  isAllowedPreviewOrigin,
  PREVIEW_MESSAGE_SOURCE,
  parsePreviewOrigins,
  parsePreviewStateMessage,
} from "./checkout-preview"

function step(
  id: string,
  overrides: Partial<TicketingStepPublic> = {},
): TicketingStepPublic {
  return {
    id,
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    step_type: "tickets",
    title: `Step ${id}`,
    order: 0,
    ...overrides,
  }
}

function runtime(steps: TicketingStepPublic[]): CheckoutRuntimeResponse {
  return {
    popup: { id: "popup-1" },
    products: [],
    buyer_form: [],
    ticketing_steps: steps,
  } as unknown as CheckoutRuntimeResponse
}

describe("applyStepDraft", () => {
  it("replaces the saved copy of the edited step", () => {
    const base = runtime([
      step("a", { title: "Saved A" }),
      step("b", { title: "Saved B", order: 1 }),
    ])

    const result = applyStepDraft(
      base,
      step("b", { title: "Draft B", order: 1 }),
    )

    expect(result.ticketing_steps.map((s) => s.title)).toEqual([
      "Saved A",
      "Draft B",
    ])
  })

  it("keeps saved fields the editor does not send", () => {
    const base = runtime([step("a", { product_category: "ticket" })])

    const result = applyStepDraft(base, {
      id: "a",
      title: "Renamed",
    } as TicketingStepPublic)

    expect(result.ticketing_steps[0].product_category).toBe("ticket")
    expect(result.ticketing_steps[0].title).toBe("Renamed")
  })

  it("appends a step the runtime does not know yet", () => {
    const base = runtime([step("a")])

    const result = applyStepDraft(base, step("new", { order: 5 }))

    expect(result.ticketing_steps).toHaveLength(2)
    expect(result.ticketing_steps[1].id).toBe("new")
  })

  it("sorts by order so the preview walks the buyer's sequence", () => {
    const base = runtime([
      step("a", { order: 2 }),
      step("b", { order: 0 }),
      step("c", { order: 1 }),
    ])

    const result = applyStepDraft(base, step("a", { order: 2 }))

    expect(result.ticketing_steps.map((s) => s.id)).toEqual(["b", "c", "a"])
  })

  it("does not mutate the runtime it was given", () => {
    const base = runtime([step("a", { title: "Saved A" })])

    applyStepDraft(base, step("a", { title: "Draft A" }))

    expect(base.ticketing_steps[0].title).toBe("Saved A")
  })
})

describe("parsePreviewOrigins", () => {
  it("splits a comma-separated list", () => {
    expect(
      parsePreviewOrigins("https://app.edgeos.world, http://localhost:5173"),
    ).toEqual(["https://app.edgeos.world", "http://localhost:5173"])
  })

  // BACKOFFICE_URL is the fallback and is written by hand in every
  // deployment's env, so a trailing slash is likely — and it used to make the
  // origin never match, with no clue as to why.
  it("normalizes a trailing slash or a path away", () => {
    expect(parsePreviewOrigins("https://app.edgeos.world/")).toEqual([
      "https://app.edgeos.world",
    ])
    expect(parsePreviewOrigins("https://app.edgeos.world/login")).toEqual([
      "https://app.edgeos.world",
    ])
  })

  it("drops values that are not URLs, and trusts nobody when unset", () => {
    expect(parsePreviewOrigins("not a url")).toEqual([])
    expect(parsePreviewOrigins("")).toEqual([])
    expect(parsePreviewOrigins(null)).toEqual([])
    expect(parsePreviewOrigins(undefined)).toEqual([])
  })
})

describe("isAllowedPreviewOrigin", () => {
  it("accepts an exact origin match", () => {
    expect(
      isAllowedPreviewOrigin("https://app.edgeos.world", [
        "https://app.edgeos.world",
      ]),
    ).toBe(true)
  })

  it("rejects anything else, including look-alike hosts", () => {
    const allowed = ["https://app.edgeos.world"]

    expect(
      isAllowedPreviewOrigin("https://app.edgeos.world.evil.com", allowed),
    ).toBe(false)
    expect(isAllowedPreviewOrigin("http://app.edgeos.world", allowed)).toBe(
      false,
    )
    expect(isAllowedPreviewOrigin("https://evil.com", allowed)).toBe(false)
  })

  it("trusts nobody when no origin is configured", () => {
    expect(isAllowedPreviewOrigin("https://app.edgeos.world", [])).toBe(false)
  })
})

describe("parsePreviewStateMessage", () => {
  const valid = {
    source: PREVIEW_MESSAGE_SOURCE,
    type: "state",
    previewToken: "token-123",
    step: step("a"),
  }

  it("accepts a well-formed state message", () => {
    expect(parsePreviewStateMessage(valid)).toEqual(valid)
  })

  it("ignores unrelated postMessage traffic", () => {
    expect(parsePreviewStateMessage(null)).toBeNull()
    expect(parsePreviewStateMessage("hello")).toBeNull()
    expect(parsePreviewStateMessage({ type: "state" })).toBeNull()
    expect(
      parsePreviewStateMessage({ ...valid, source: "some-extension" }),
    ).toBeNull()
    expect(parsePreviewStateMessage({ ...valid, type: "ready" })).toBeNull()
  })

  // The preview covers the whole checkout, so it is driven with just a token
  // whenever no step is open in the editor.
  it("accepts a message with no step", () => {
    expect(parsePreviewStateMessage({ ...valid, step: undefined })).toEqual({
      ...valid,
      step: undefined,
    })
    expect(parsePreviewStateMessage({ ...valid, step: null })).toEqual({
      ...valid,
      step: null,
    })
  })

  it("rejects a message with no token, or with a malformed step", () => {
    expect(parsePreviewStateMessage({ ...valid, previewToken: "" })).toBeNull()
    expect(
      parsePreviewStateMessage({ ...valid, step: { title: "x" } }),
    ).toBeNull()
  })
})
