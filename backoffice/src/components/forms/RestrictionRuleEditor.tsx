import { Plus, Trash2 } from "lucide-react"
import { FieldError } from "@/components/Common/FieldError"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type {
  HasPurchasedScope,
  RestrictionCombinator,
  RestrictionLeafDraft,
  RestrictionOp,
  RestrictionPredicateKind,
} from "@/lib/salesFlowRestrictionRule"

// Must stay in sync with backend/app/services/restrictions/schemas.py's
// HUMAN_PROFILE_FIELDS allowlist — the closed set of Humans attributes a
// human_profile_field predicate may reference.
const HUMAN_PROFILE_FIELDS = [
  "email",
  "first_name",
  "last_name",
  "telegram",
  "gender",
  "age",
  "residence",
  "rating",
  "red_flag",
] as const

const KIND_LABELS: Record<RestrictionPredicateKind, string> = {
  form_answer: "Form Answer",
  human_profile_field: "Profile Field",
  has_purchased: "Has Purchased",
}

const OP_LABELS: Record<RestrictionOp, string> = {
  eq: "equals",
  neq: "does not equal",
  in: "is one of",
  not_in: "is not one of",
  exists: "was answered",
}

function emptyLeaf(kind: RestrictionPredicateKind): RestrictionLeafDraft {
  if (kind === "has_purchased") {
    return { kind, scope: "product", op: "exists", value: "", negate: false }
  }
  if (kind === "human_profile_field") {
    return {
      kind,
      field: HUMAN_PROFILE_FIELDS[0],
      op: "eq",
      value: "",
      negate: false,
    }
  }
  return { kind, field_name: "", op: "eq", value: "", negate: false }
}

interface RestrictionRuleEditorProps {
  combinator: RestrictionCombinator
  leaves: RestrictionLeafDraft[]
  unsupported: boolean
  onChange: (
    combinator: RestrictionCombinator,
    leaves: RestrictionLeafDraft[],
  ) => void
  readOnly?: boolean
  error?: string
}

/**
 * Structured builder for a flow's `restriction_rule` (task 14.1). Deliberately
 * flat — one combinator (all_of/any_of) over a list of leaf predicate rows —
 * never a freeform JSON textarea, matching the closed 3-predicate/5-op set
 * `backend/app/services/restrictions/schemas.py` enforces server-side.
 */
export function RestrictionRuleEditor({
  combinator,
  leaves,
  unsupported,
  onChange,
  readOnly = false,
  error,
}: RestrictionRuleEditorProps) {
  if (unsupported) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        This flow's restriction rule uses a nested condition structure this
        builder doesn't support editing. It stays in effect unchanged; contact
        an engineer to modify it.
      </div>
    )
  }

  const updateLeaf = (index: number, patch: Partial<RestrictionLeafDraft>) => {
    const next = leaves.map((leaf, i) =>
      i === index ? { ...leaf, ...patch } : leaf,
    )
    onChange(combinator, next)
  }

  const removeLeaf = (index: number) => {
    onChange(
      combinator,
      leaves.filter((_, i) => i !== index),
    )
  }

  const addLeaf = () => {
    onChange(combinator, [...leaves, emptyLeaf("form_answer")])
  }

  return (
    <div className="space-y-3">
      {leaves.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No restriction: every eligible buyer can purchase from this flow.
        </p>
      ) : (
        <>
          {leaves.length > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Buyer must match</span>
              <Select
                value={combinator}
                onValueChange={(value) =>
                  onChange(value as RestrictionCombinator, leaves)
                }
                disabled={readOnly}
              >
                <SelectTrigger className="w-32 text-sm" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_of">all of</SelectItem>
                  <SelectItem value="any_of">any of</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">
                the conditions below
              </span>
            </div>
          )}
          {leaves.map((leaf, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-md border p-3"
            >
              <Select
                value={leaf.kind}
                onValueChange={(value) =>
                  updateLeaf(
                    index,
                    emptyLeaf(value as RestrictionPredicateKind),
                  )
                }
                disabled={readOnly}
              >
                <SelectTrigger
                  className="w-40 text-sm"
                  size="sm"
                  data-testid={`restriction-kind-${index}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {leaf.kind === "form_answer" && (
                <Input
                  placeholder="field_name"
                  value={leaf.field_name ?? ""}
                  onChange={(e) =>
                    updateLeaf(index, { field_name: e.target.value })
                  }
                  disabled={readOnly}
                  className="w-40 text-sm"
                />
              )}

              {leaf.kind === "human_profile_field" && (
                <Select
                  value={leaf.field ?? HUMAN_PROFILE_FIELDS[0]}
                  onValueChange={(value) => updateLeaf(index, { field: value })}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-40 text-sm" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HUMAN_PROFILE_FIELDS.map((field) => (
                      <SelectItem key={field} value={field}>
                        {field}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {leaf.kind === "has_purchased" && (
                <Select
                  value={leaf.scope ?? "product"}
                  onValueChange={(value) =>
                    updateLeaf(index, { scope: value as HasPurchasedScope })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-32 text-sm" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">product</SelectItem>
                    <SelectItem value="category">category</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {leaf.kind !== "has_purchased" && (
                <Select
                  value={leaf.op}
                  onValueChange={(value) =>
                    updateLeaf(index, { op: value as RestrictionOp })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-36 text-sm" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(OP_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {leaf.kind !== "has_purchased" && leaf.op !== "exists" && (
                <Input
                  placeholder="value"
                  value={leaf.value ?? ""}
                  onChange={(e) => updateLeaf(index, { value: e.target.value })}
                  disabled={readOnly}
                  className="w-40 text-sm"
                />
              )}

              {leaf.kind === "has_purchased" && (
                <Input
                  placeholder={
                    leaf.scope === "product" ? "product id" : "category"
                  }
                  value={leaf.value ?? ""}
                  onChange={(e) => updateLeaf(index, { value: e.target.value })}
                  disabled={readOnly}
                  className="w-48 text-sm"
                />
              )}

              <div className="flex items-center gap-1.5">
                <Switch
                  checked={leaf.negate}
                  onCheckedChange={(checked) =>
                    updateLeaf(index, { negate: checked })
                  }
                  disabled={readOnly}
                  aria-label="Negate this condition"
                />
                <span className="text-xs text-muted-foreground">Negate</span>
              </div>

              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove condition"
                  onClick={() => removeLeaf(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </>
      )}

      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={addLeaf}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add condition
        </Button>
      )}

      <FieldError errors={[error]} />
    </div>
  )
}
