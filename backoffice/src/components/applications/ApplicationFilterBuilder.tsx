import {
  EMPTYABLE_TEXT_OPS,
  FilterBuilder,
  type FilterCondition,
  type FilterFieldDef,
  type FilterMatch,
  FULL_TEXT_OPS,
} from "@/components/Common/FilterBuilder"
import { RATING_OPTIONS } from "@/components/Humans/humanFields"

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

// Base fields configured as selects in the form builder carry fixed
// options; surface them as a value picker instead of free text.
function baseFieldDef(
  key: string,
  label: string,
  baseFieldOptions: Record<string, string[]>,
  textOps: string[] = EMPTYABLE_TEXT_OPS,
): FilterFieldDef {
  const options = baseFieldOptions[key]
  if (options?.length) {
    return {
      key,
      label,
      kind: "select",
      ops: EMPTYABLE_TEXT_OPS,
      options: options.map((opt) => ({ value: opt, label: opt })),
    }
  }
  return { key, label, kind: "text", ops: textOps }
}

function buildFieldDefs(
  statusOptions: { value: string; label: string }[],
  customFields: CustomFilterField[],
  reviewerOptions: { value: string; label: string }[] = [],
  baseFieldOptions: Record<string, string[]> = {},
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
      key: "scholarship_video_url",
      label: "Scholarship video",
      kind: "text",
      ops: FULL_TEXT_OPS,
    },
    {
      key: "rating",
      label: "Rating",
      kind: "select",
      ops: ["eq", "neq"],
      options: RATING_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
      })),
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
    baseFieldDef("gender", "Gender", baseFieldOptions),
    baseFieldDef("age", "Age", baseFieldOptions),
    baseFieldDef("residence", "Residence", baseFieldOptions, FULL_TEXT_OPS),
    { key: "telegram", label: "Telegram", kind: "text", ops: FULL_TEXT_OPS },
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
  baseFieldOptions,
  match,
  conditions,
  onChange,
}: {
  statusOptions: { value: string; label: string }[]
  customFields: CustomFilterField[]
  reviewerOptions?: { value: string; label: string }[]
  baseFieldOptions?: Record<string, string[]>
  match: FilterMatch
  conditions: FilterCondition[]
  onChange: (match: FilterMatch, conditions: FilterCondition[]) => void
}) {
  return (
    <FilterBuilder
      fields={buildFieldDefs(
        statusOptions,
        customFields,
        reviewerOptions,
        baseFieldOptions,
      )}
      match={match}
      conditions={conditions}
      onChange={onChange}
      emptyMessage="No filters applied. Add a filter to narrow down applications."
    />
  )
}
