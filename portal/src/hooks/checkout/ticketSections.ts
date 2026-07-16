/**
 * Shared ticket section helpers — used by both VariantTicketSelect and
 * VariantTicketCard (and any future skins).
 *
 * These were previously duplicated inline in VariantTicketSelect.tsx.
 * This module is the single authoritative source.
 */

import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionVisibilityCondition {
  field_id: string
  value: string | string[]
}

export interface TemplateSection {
  key: string
  label: string
  order: number
  product_ids: string[]
  attendee_categories?: string[] | null
  visible_if?: SectionVisibilityCondition | null
  /** Presentation authored per section in the backoffice (see backoffice
   *  SortableSectionCard's `ProductSection`). These describe the section as a
   *  whole — the products it groups only supply name and price. */
  image_url?: string
  image_aspect?: string
  description?: string
}

// ---------------------------------------------------------------------------
// parseSections
// ---------------------------------------------------------------------------

/**
 * Parse and sort the sections array from a template config object.
 * Returns an empty array when the config is absent or malformed.
 */
export function parseSections(
  templateConfig: Record<string, unknown> | null | undefined,
): TemplateSection[] {
  const raw = templateConfig?.sections
  if (!Array.isArray(raw) || raw.length === 0) return []
  return [...(raw as TemplateSection[])].sort((a, b) => a.order - b.order)
}

// ---------------------------------------------------------------------------
// isSectionVisibleForApp
// ---------------------------------------------------------------------------

/**
 * True when the section's visible_if condition matches the application's form
 * answers. No visible_if -> always visible. Missing or null customFields ->
 * visible (open-ticketing fallback: the form hasn't been answered yet, treat
 * as no-gate). An application that never answered the gating field also passes:
 * hiding every gated section would leave the attendee unable to buy those
 * passes at all.
 */
export function isSectionVisibleForApp(
  section: TemplateSection,
  customFields: Record<string, unknown> | null | undefined,
): boolean {
  const cond = section.visible_if
  if (!cond?.field_id) return true
  if (!customFields) return true
  const answer = customFields[cond.field_id]
  if (answer == null || answer === "") return true
  const expected = Array.isArray(cond.value) ? cond.value : [cond.value]
  return expected.includes(answer as string)
}

// ---------------------------------------------------------------------------
// buildSectionGroups
// ---------------------------------------------------------------------------

/**
 * Build product groups for a single attendee based on configured sections.
 * - Products not in any section are excluded.
 * - Sections gated by attendee_categories are filtered to the current attendee.
 * - Note: visible_if (per-application gating) must be evaluated upstream;
 *   by the time sections reach this function they should already be filtered
 *   by isSectionVisibleForApp.
 * - Patreon products are excluded from section groups.
 * - Falls back to duration-type grouping when no sections are configured.
 */
export function buildSectionGroups(
  attendee: AttendeePassState,
  sections: TemplateSection[],
): { section: TemplateSection; products: ProductsPass[] }[] {
  if (sections.length === 0) {
    return buildDurationGroups(attendee)
  }

  const attendeeCategoryId = attendee.category_id ?? null
  const visibleSections = sections.filter((s) => {
    if (s.attendee_categories == null) return true
    if (!attendeeCategoryId) return false
    return s.attendee_categories.includes(attendeeCategoryId)
  })

  const productMap = new Map(
    attendee.products
      .filter((p) => p.category !== "patreon")
      .map((p) => [p.id, p]),
  )

  return visibleSections
    .map((section) => ({
      section,
      products: section.product_ids
        .map((id) => productMap.get(id))
        .filter(Boolean) as ProductsPass[],
    }))
    .filter((g) => g.products.length > 0)
}

// ---------------------------------------------------------------------------
// buildDurationGroups (fallback — no sections configured)
// ---------------------------------------------------------------------------

function sortProductsByPriority(a: ProductsPass, b: ProductsPass): number {
  const rank = (p: ProductsPass) => {
    if (p.duration_type === "full") return 0
    if (p.duration_type === "month") return 1
    if (p.duration_type === "week") return 2
    if (p.duration_type === "day") return 3
    return 4
  }
  return rank(a) - rank(b)
}

function buildDurationGroups(
  attendee: AttendeePassState,
): { section: TemplateSection; products: ProductsPass[] }[] {
  const isChild =
    attendee.category === "kid" ||
    attendee.category === "teen" ||
    attendee.category === "baby"

  const all = attendee.products
    .filter((p) => p.category !== "patreon")
    .sort(sortProductsByPriority)

  const groups: { section: TemplateSection; products: ProductsPass[] }[] = []
  const add = (key: string, label: string, items: ProductsPass[]) => {
    if (items.length > 0)
      groups.push({
        section: { key, label, order: groups.length, product_ids: [] },
        products: items,
      })
  }

  if (!isChild) {
    add(
      "full",
      "Full Passes",
      all.filter((p) => p.duration_type === "full"),
    )
    add(
      "month",
      "Month Pass",
      all.filter((p) => p.duration_type === "month"),
    )
  }
  add(
    "week",
    "Weekly Passes",
    all.filter((p) => p.duration_type === "week"),
  )
  add(
    "day",
    "Day Passes",
    all.filter((p) => p.duration_type === "day"),
  )

  return groups
}
