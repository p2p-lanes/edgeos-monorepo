import { Funnel, Plus, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type FilterMatch = "all" | "any"

export interface FilterCondition {
  field: string
  op: string
  value: string | boolean | null
}

/** Custom form-builder field exposed as a filterable attribute. */
export interface CustomFilterField {
  name: string
  label: string
  options?: string[]
  isSelect: boolean
}

const NO_VALUE_OPS = new Set(["is_empty", "not_empty"])

const OP_LABELS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  is_empty: "is empty",
  not_empty: "is not empty",
  before: "before",
  after: "after",
}

type FieldKind = "select" | "boolean" | "date" | "text"

interface FilterFieldDef {
  key: string
  label: string
  kind: FieldKind
  ops: string[]
  options?: { value: string; label: string }[]
}

const EMPTYABLE_TEXT_OPS = ["eq", "neq", "is_empty", "not_empty"]
const FULL_TEXT_OPS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "is_empty",
  "not_empty",
]
const DATE_OPS = ["before", "after", "is_empty", "not_empty"]

const SCHOLARSHIP_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

function buildFieldDefs(
  statusOptions: { value: string; label: string }[],
  customFields: CustomFilterField[],
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
  }))
  return [...fixed, ...custom]
}

function defaultValueFor(
  def: FilterFieldDef,
  op: string,
): FilterCondition["value"] {
  if (NO_VALUE_OPS.has(op)) return null
  if (def.kind === "boolean") return true
  if (def.kind === "select") return def.options?.[0]?.value ?? ""
  return ""
}

export function isCompleteCondition(condition: FilterCondition): boolean {
  if (NO_VALUE_OPS.has(condition.op)) return true
  return condition.value !== null && condition.value !== ""
}

/** Keeps only well-shaped conditions coming from the URL. */
export function sanitizeFilterConditions(raw: unknown): FilterCondition[] {
  if (!Array.isArray(raw)) return []
  const conditions: FilterCondition[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const { field, op, value } = item as Record<string, unknown>
    if (typeof field !== "string" || !field) continue
    if (typeof op !== "string" || !(op in OP_LABELS)) continue
    conditions.push({
      field,
      op,
      value:
        typeof value === "string" || typeof value === "boolean" ? value : null,
    })
  }
  return conditions
}

function DebouncedTextInput({
  value,
  onCommit,
  type = "text",
}: {
  value: string
  onCommit: (value: string) => void
  type?: string
}) {
  const [local, setLocal] = useState(value)
  const committed = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setLocal(value)
    }
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <Input
      type={type}
      className="h-8 flex-1"
      placeholder="Value"
      value={local}
      onChange={(e) => {
        const next = e.target.value
        setLocal(next)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          committed.current = next
          onCommit(next)
        }, 300)
      }}
    />
  )
}

function ConditionValueInput({
  def,
  condition,
  onValueChange,
}: {
  def: FilterFieldDef
  condition: FilterCondition
  onValueChange: (value: FilterCondition["value"]) => void
}) {
  if (NO_VALUE_OPS.has(condition.op)) return null

  if (def.kind === "boolean") {
    return (
      <Select
        value={condition.value === false ? "false" : "true"}
        onValueChange={(v) => onValueChange(v === "true")}
      >
        <SelectTrigger className="h-8 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  if (def.kind === "select") {
    const current = typeof condition.value === "string" ? condition.value : ""
    return (
      <Select
        value={current || undefined}
        onValueChange={(v) => onValueChange(v)}
      >
        <SelectTrigger className="h-8 flex-1">
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          {(def.options ?? []).map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const current = typeof condition.value === "string" ? condition.value : ""
  if (def.kind === "date") {
    return (
      <Input
        type="date"
        className="h-8 flex-1"
        value={current}
        onChange={(e) => onValueChange(e.target.value)}
      />
    )
  }

  return <DebouncedTextInput value={current} onCommit={onValueChange} />
}

export function ApplicationFilterBuilder({
  statusOptions,
  customFields,
  match,
  conditions,
  onChange,
}: {
  statusOptions: { value: string; label: string }[]
  customFields: CustomFilterField[]
  match: FilterMatch
  conditions: FilterCondition[]
  onChange: (match: FilterMatch, conditions: FilterCondition[]) => void
}) {
  const fieldDefs = buildFieldDefs(statusOptions, customFields)
  const fixedDefs = fieldDefs.filter((def) => !def.key.startsWith("custom."))
  const customDefs = fieldDefs.filter((def) => def.key.startsWith("custom."))
  const activeCount = conditions.filter(isCompleteCondition).length

  const findDef = (key: string) => fieldDefs.find((def) => def.key === key)

  const addCondition = () => {
    const statusDef = fieldDefs[0]
    onChange(match, [
      ...conditions,
      {
        field: statusDef.key,
        op: statusDef.ops[0],
        value: defaultValueFor(statusDef, statusDef.ops[0]),
      },
    ])
  }

  const updateCondition = (index: number, next: FilterCondition) => {
    onChange(
      match,
      conditions.map((cond, i) => (i === index ? next : cond)),
    )
  }

  const removeCondition = (index: number) => {
    onChange(
      match,
      conditions.filter((_, i) => i !== index),
    )
  }

  const changeField = (index: number, key: string) => {
    const def = findDef(key)
    if (!def) return
    updateCondition(index, {
      field: key,
      op: def.ops[0],
      value: defaultValueFor(def, def.ops[0]),
    })
  }

  const changeOp = (index: number, op: string) => {
    const condition = conditions[index]
    const def = findDef(condition.field)
    if (!def) return
    const needsReset = NO_VALUE_OPS.has(op) !== NO_VALUE_OPS.has(condition.op)
    updateCondition(index, {
      ...condition,
      op,
      value: needsReset ? defaultValueFor(def, op) : condition.value,
    })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9">
          <Funnel className="mr-2 h-4 w-4" />
          Filter
          {activeCount > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary tabular-nums">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[560px] p-3">
        {conditions.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              No filters applied. Add a filter to narrow down applications.
            </p>
            <Button variant="outline" size="sm" onClick={addCondition}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add filter
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Match</span>
              <Select
                value={match}
                onValueChange={(v) => onChange(v as FilterMatch, conditions)}
              >
                <SelectTrigger className="h-7 w-[70px] text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="any">any</SelectItem>
                </SelectContent>
              </Select>
              <span>of the following filters</span>
            </div>
            {conditions.map((condition, index) => {
              const def = findDef(condition.field)
              return (
                <div
                  key={`${index}-${condition.field}-${condition.op}`}
                  className="flex items-center gap-2"
                >
                  <Select
                    value={condition.field}
                    onValueChange={(key) => changeField(index, key)}
                  >
                    <SelectTrigger className="h-8 w-[170px] shrink-0">
                      <SelectValue placeholder="Field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {fixedDefs.map((fieldDef) => (
                          <SelectItem key={fieldDef.key} value={fieldDef.key}>
                            {fieldDef.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {customDefs.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Form fields</SelectLabel>
                          {customDefs.map((fieldDef) => (
                            <SelectItem key={fieldDef.key} value={fieldDef.key}>
                              {fieldDef.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  <Select
                    value={condition.op}
                    onValueChange={(op) => changeOp(index, op)}
                  >
                    <SelectTrigger className="h-8 w-[140px] shrink-0">
                      <SelectValue placeholder="Operator" />
                    </SelectTrigger>
                    <SelectContent>
                      {(def?.ops ?? []).map((op) => (
                        <SelectItem key={op} value={op}>
                          {OP_LABELS[op]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {def ? (
                    <ConditionValueInput
                      def={def}
                      condition={condition}
                      onValueChange={(value) =>
                        updateCondition(index, { ...condition, value })
                      }
                    />
                  ) : (
                    <div className="flex-1" />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    aria-label="Remove filter"
                    onClick={() => removeCondition(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}
            <div>
              <Button variant="ghost" size="sm" onClick={addCondition}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add filter
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
