interface FilterConditionWithField {
  field: string
}

export const FIXED_GROUP_BY_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "scholarship_status", label: "Scholarship status" },
  { value: "reviewed_by", label: "Reviewed by" },
  { value: "gender", label: "Gender" },
  { value: "age", label: "Age" },
]

export function availableFixedGroupByOptions(
  excludeKey?: string,
  excludeReviewedBy = false,
) {
  return FIXED_GROUP_BY_OPTIONS.filter(
    (option) =>
      option.value !== excludeKey &&
      (!excludeReviewedBy || option.value !== "reviewed_by"),
  )
}

export function hasReviewerFilter(
  conditions: FilterConditionWithField[],
): boolean {
  return conditions.some((condition) => condition.field === "reviewed_by")
}

export function normalizeReviewerGrouping(
  conditions: FilterConditionWithField[],
  groupBy?: string,
  subGroupBy?: string,
): { groupBy?: string; subGroupBy?: string } {
  if (!hasReviewerFilter(conditions)) return { groupBy, subGroupBy }

  if (groupBy === "reviewed_by") {
    return { groupBy: undefined, subGroupBy: undefined }
  }

  return {
    groupBy,
    subGroupBy: subGroupBy === "reviewed_by" ? undefined : subGroupBy,
  }
}
