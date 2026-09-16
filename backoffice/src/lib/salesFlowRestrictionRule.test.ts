import { describe, expect, it } from "vitest"
import {
  draftsToRestrictionRule,
  parseRestrictionRuleToDrafts,
} from "./salesFlowRestrictionRule"

describe("parseRestrictionRuleToDrafts", () => {
  it("returns an empty all_of draft for null (no rule / feature off)", () => {
    expect(parseRestrictionRuleToDrafts(null)).toEqual({
      combinator: "all_of",
      leaves: [],
      unsupported: false,
    })
  })

  it("parses a flat all_of tree of leaves", () => {
    const rule = {
      all_of: [
        { kind: "form_answer", field_name: "vip", op: "eq", value: "yes" },
        {
          kind: "has_product",
          scope: "category",
          value: "ticket",
          op: "exists",
        },
      ],
    }
    const result = parseRestrictionRuleToDrafts(rule)
    expect(result.combinator).toBe("all_of")
    expect(result.unsupported).toBe(false)
    expect(result.leaves).toHaveLength(2)
    expect(result.leaves[0]).toMatchObject({
      kind: "form_answer",
      field_name: "vip",
      op: "eq",
      value: "yes",
    })
  })

  it("parses a flat any_of tree of leaves", () => {
    const rule = {
      any_of: [
        {
          kind: "human_profile_field",
          field: "residence",
          op: "eq",
          value: "US",
        },
      ],
    }
    const result = parseRestrictionRuleToDrafts(rule)
    expect(result.combinator).toBe("any_of")
    expect(result.leaves).toHaveLength(1)
  })

  it("parses a bare single leaf (no wrapping all_of/any_of) as one row", () => {
    const rule = {
      kind: "form_answer",
      field_name: "vip",
      op: "exists",
      value: null,
    }
    const result = parseRestrictionRuleToDrafts(rule)
    expect(result.unsupported).toBe(false)
    expect(result.leaves).toHaveLength(1)
  })

  it("flags a nested tree as unsupported by the flat builder", () => {
    const rule = {
      all_of: [
        {
          any_of: [
            { kind: "form_answer", field_name: "a", op: "exists", value: null },
          ],
        },
      ],
    }
    const result = parseRestrictionRuleToDrafts(rule)
    expect(result.unsupported).toBe(true)
  })
})

describe("draftsToRestrictionRule", () => {
  it("returns null for an empty leaf list (feature off)", () => {
    expect(draftsToRestrictionRule("all_of", [])).toBeNull()
  })

  it("wraps leaves under the chosen combinator", () => {
    const result = draftsToRestrictionRule("any_of", [
      {
        kind: "form_answer",
        field_name: "vip",
        op: "eq",
        value: "yes",
        negate: false,
      },
    ])
    expect(result).toEqual({
      any_of: [
        {
          kind: "form_answer",
          field_name: "vip",
          op: "eq",
          value: "yes",
          negate: false,
        },
      ],
    })
  })

  it("round-trips through parse -> draft -> serialize", () => {
    const rule = {
      all_of: [
        {
          kind: "has_product",
          scope: "product",
          value: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          op: "exists",
          negate: true,
        },
      ],
    }
    const parsed = parseRestrictionRuleToDrafts(rule)
    const serialized = draftsToRestrictionRule(parsed.combinator, parsed.leaves)
    expect(serialized).toEqual(rule)
  })
})

describe("the predicate the backend actually accepts", () => {
  it("is called has_product on the way out", () => {
    // It used to send `has_purchased`, which the backend's closed enum
    // rejected outright — so no product condition could ever be saved from
    // the backoffice, and the 422 read "Extra inputs are not permitted".
    const payload = draftsToRestrictionRule("all_of", [
      {
        kind: "has_product",
        scope: "category",
        op: "exists",
        value: "ticket",
        negate: false,
      },
    ])
    expect(payload).toEqual({
      all_of: [
        {
          kind: "has_product",
          scope: "category",
          op: "exists",
          value: "ticket",
          negate: false,
        },
      ],
    })
  })

  it("is recognised on the way in", () => {
    // A saved rule the builder does not recognise renders as "uses a nested
    // condition structure this builder doesn't support editing", which was
    // untrue: the rule is flat, the name was wrong.
    const draft = parseRestrictionRuleToDrafts({
      all_of: [
        {
          kind: "has_product",
          scope: "product",
          op: "exists",
          value: "a-product-id",
          negate: false,
        },
      ],
    })
    expect(draft.unsupported).toBe(false)
    expect(draft.leaves).toHaveLength(1)
    expect(draft.leaves[0].kind).toBe("has_product")
  })
})
