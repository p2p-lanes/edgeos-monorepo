import { describe, expect, it } from "vitest"

import { buildApplicationFilterFieldDefs } from "./ApplicationFilterBuilder"
import {
  availableFixedGroupByOptions,
  hasReviewerFilter,
  normalizeReviewerGrouping,
} from "./reviewerGrouping"

const reviewerFilter = [{ field: "reviewed_by" }]

describe("reviewer filter and grouping", () => {
  it("removes reviewer grouping when a reviewer filter is added", () => {
    expect(
      normalizeReviewerGrouping(reviewerFilter, "reviewed_by", "status"),
    ).toEqual({ groupBy: undefined, subGroupBy: undefined })
  })

  it("prevents reviewer grouping when a reviewer filter already exists", () => {
    expect(hasReviewerFilter(reviewerFilter)).toBe(true)
    expect(
      availableFixedGroupByOptions(
        undefined,
        hasReviewerFilter(reviewerFilter),
      ),
    ).not.toContainEqual({ value: "reviewed_by", label: "Reviewed by" })
  })

  it("keeps Reviewed by visible before reviewer options have loaded", () => {
    const fields = buildApplicationFilterFieldDefs([], [])

    expect(fields.some((field) => field.key === "reviewed_by")).toBe(true)
  })

  it("normalizes a conflicting URL state by removing reviewer primary grouping", () => {
    expect(
      normalizeReviewerGrouping(reviewerFilter, "reviewed_by", "status"),
    ).toEqual({ groupBy: undefined, subGroupBy: undefined })
  })
})
