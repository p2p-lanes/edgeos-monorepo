import {
  EMPTYABLE_TEXT_OPS,
  FilterBuilder,
  type FilterCondition,
  type FilterFieldDef,
  type FilterMatch,
  FULL_TEXT_OPS,
} from "@/components/Common/FilterBuilder"

export {
  type FilterCondition,
  type FilterMatch,
  isCompleteCondition,
  sanitizeFilterConditions,
} from "@/components/Common/FilterBuilder"

/** Custom form-builder field exposed as a filterable attribute. */
export interface CustomFilterField {
  name: string
  label: string
  options?: string[]
  isSelect: boolean
}

const DATE_OPS = ["before", "after", "is_empty", "not_empty"]

const SCHOLARSHIP_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

function buildFieldDefs(
  statusOptions: { value: string; label: string }[],
  customFields: CustomFilterField[],
  reviewerOptions: { value: string; label: string }[] = [],
): FilterFieldDef[] {
  const fixed: FilterFieldDef[] = [
    {
      key: "status",
      label: "Status",
      kind: "select",
      ops: ["eq", "neq"],
      options: statusOptions,
    },
    {
      key: "scholarship_request",
      label: "Scholarship requested",
      kind: "boolean",
      ops: ["eq"],
    },
    {
      key: "scholarship_status",
      label: "Scholarship status",
      kind: "select",
      ops: EMPTYABLE_TEXT_OPS,
      options: SCHOLARSHIP_STATUS_OPTIONS,
    },
    {
      key: "skipped_by_me",
      label: "Skipped by me",
      kind: "boolean",
      ops: ["eq"],
    },
    {
      key: "reviewed_by_me",
      label: "Reviewed by me",
      kind: "boolean",
      ops: ["eq"],
    },
    ...(reviewerOptions.length
      ? [
          {
            key: "reviewed_by",
            label: "Reviewed by",
            kind: "select",
            ops: ["eq", "neq"],
            options: reviewerOptions,
          } satisfies FilterFieldDef,
        ]
      : []),
    { key: "submitted_at", label: "Submitted", kind: "date", ops: DATE_OPS },
    { key: "accepted_at", label: "Accepted", kind: "date", ops: DATE_OPS },
    { key: "referral", label: "Referral", kind: "text", ops: FULL_TEXT_OPS },
    { key: "gender", label: "Gender", kind: "text", ops: EMPTYABLE_TEXT_OPS },
    { key: "age", label: "Age", kind: "text", ops: EMPTYABLE_TEXT_OPS },
  ]
  const custom: FilterFieldDef[] = customFields.map((field) => ({
    key: `custom.${field.name}`,
    label: field.label,
    kind: field.isSelect ? "select" : "text",
    ops: FULL_TEXT_OPS,
    options: field.isSelect
      ? (field.options ?? []).map((opt) => ({ value: opt, label: opt }))
      : undefined,
    group: "Form fields",
  }))
  return [...fixed, ...custom]
}

export function ApplicationFilterBuilder({
  statusOptions,
  customFields,
  reviewerOptions,
  match,
  conditions,
  onChange,
}: {
  statusOptions: { value: string; label: string }[]
  customFields: CustomFilterField[]
  reviewerOptions?: { value: string; label: string }[]
  match: FilterMatch
  conditions: FilterCondition[]
  onChange: (match: FilterMatch, conditions: FilterCondition[]) => void
}) {
  return (
    <FilterBuilder
      fields={buildFieldDefs(statusOptions, customFields, reviewerOptions)}
      match={match}
      conditions={conditions}
      onChange={onChange}
      emptyMessage="No filters applied. Add a filter to narrow down applications."
    />
  )
}
