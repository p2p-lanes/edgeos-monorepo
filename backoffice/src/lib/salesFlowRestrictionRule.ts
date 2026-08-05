/**
 * Pure helpers for the sales-flow restriction rule builder (task 14.1).
 *
 * The backend's closed schema (`backend/app/services/restrictions/schemas.py`)
 * allows an arbitrarily nested AND/OR tree of leaf predicates. The backoffice
 * builder deliberately stays FLAT (one combinator, one list of leaves) per
 * the orchestrator's brief: "keep the UI minimal and honest: structured
 * builder, not freeform JSON". A rule saved through another surface (or a
 * future nested-tree UI) that doesn't fit this flat shape is loaded as
 * `unsupported: true` and rendered read-only rather than silently
 * flattened or discarded.
 */

export type RestrictionOp = "eq" | "neq" | "in" | "not_in" | "exists"
export type RestrictionCombinator = "all_of" | "any_of"
export type RestrictionPredicateKind =
  | "form_answer"
  | "human_profile_field"
  | "has_purchased"
export type HasPurchasedScope = "product" | "category"

export interface RestrictionLeafDraft {
  kind: RestrictionPredicateKind
  /** form_answer only */
  field_name?: string
  /** human_profile_field only */
  field?: string
  /** has_purchased only */
  scope?: HasPurchasedScope
  op: RestrictionOp
  value: string | null
  negate: boolean
}

export interface RestrictionRuleDraft {
  combinator: RestrictionCombinator
  leaves: RestrictionLeafDraft[]
  /** True when the loaded rule is nested (a group inside a group) or
   * otherwise outside the flat shape this builder can represent. */
  unsupported: boolean
}

function isLeafShape(node: Record<string, unknown>): boolean {
  return (
    typeof node.kind === "string" &&
    ["form_answer", "human_profile_field", "has_purchased"].includes(node.kind)
  )
}

function toLeafDraft(node: Record<string, unknown>): RestrictionLeafDraft {
  return {
    kind: node.kind as RestrictionPredicateKind,
    field_name:
      typeof node.field_name === "string" ? node.field_name : undefined,
    field: typeof node.field === "string" ? node.field : undefined,
    scope: (node.scope as HasPurchasedScope | undefined) ?? undefined,
    op: (node.op as RestrictionOp) ?? "eq",
    value:
      node.value === undefined || node.value === null
        ? null
        : String(node.value),
    negate: Boolean(node.negate),
  }
}

/**
 * Parses a `restriction_rule` API payload (`Record<string, unknown> | null`)
 * into the flat builder's draft shape. `null` (feature off) becomes an
 * empty `all_of` draft, matching the "no leaves = feature off" write side.
 */
export function parseRestrictionRuleToDrafts(
  rule: Record<string, unknown> | null,
): RestrictionRuleDraft {
  if (rule === null) {
    return { combinator: "all_of", leaves: [], unsupported: false }
  }

  if (isLeafShape(rule)) {
    return {
      combinator: "all_of",
      leaves: [toLeafDraft(rule)],
      unsupported: false,
    }
  }

  const combinator: RestrictionCombinator = Array.isArray(rule.all_of)
    ? "all_of"
    : "any_of"
  const children = (rule.all_of ?? rule.any_of) as unknown[] | undefined

  if (!Array.isArray(children)) {
    return { combinator: "all_of", leaves: [], unsupported: true }
  }

  const leaves: RestrictionLeafDraft[] = []
  for (const child of children) {
    if (
      typeof child !== "object" ||
      child === null ||
      !isLeafShape(child as Record<string, unknown>)
    ) {
      return { combinator, leaves: [], unsupported: true }
    }
    leaves.push(toLeafDraft(child as Record<string, unknown>))
  }

  return { combinator, leaves, unsupported: false }
}

function leafDraftToPayload(
  leaf: RestrictionLeafDraft,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: leaf.kind,
    op: leaf.op,
    value: leaf.value,
    negate: leaf.negate,
  }
  if (leaf.kind === "form_answer") base.field_name = leaf.field_name
  if (leaf.kind === "human_profile_field") base.field = leaf.field
  if (leaf.kind === "has_purchased") {
    base.scope = leaf.scope
    // has_purchased's op defaults server-side to "exists" and value is a
    // required string (product uuid or category name) — never the
    // free-typed comparison value the other two kinds use.
  }
  return base
}

/**
 * Serializes the flat builder's drafts back into a `restriction_rule` API
 * payload. An empty leaf list serializes to `null` (feature off) — the
 * same "no leaves" contract `parseRestrictionRuleToDrafts` reads from.
 */
export function draftsToRestrictionRule(
  combinator: RestrictionCombinator,
  leaves: RestrictionLeafDraft[],
): Record<string, unknown> | null {
  if (leaves.length === 0) return null
  return { [combinator]: leaves.map(leafDraftToPayload) }
}
