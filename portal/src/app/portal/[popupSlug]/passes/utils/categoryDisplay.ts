import type { LucideIcon } from "lucide-react"
import { Bed, Box, Package, Ticket, Utensils } from "lucide-react"

/**
 * Category display helpers for the passes view-mode ticket list.
 *
 * Known categories: ticket, housing, merch, meal_plan, other.
 * Patreon is excluded from this list (filtered upstream by AttendeeTicket).
 * Unknown categories fall through to the "other" / Box fallback.
 */

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ticket: Ticket,
  housing: Bed,
  merch: Package,
  meal_plan: Utensils,
  other: Box,
}

/**
 * Returns the Lucide icon component for a given product category.
 * Falls back to Box for unknown or null/undefined categories.
 */
export function getCategoryIcon(
  category: string | null | undefined,
): LucideIcon {
  if (!category) return Box
  return CATEGORY_ICONS[category] ?? Box
}

/**
 * Returns the i18n label for a given product category.
 * Uses the `passes.categories.{key}` translation key.
 * Unknown categories (including patreon, if leaked) fall back to the
 * capitalized raw category string.
 */
export function getCategoryLabel(
  category: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!category) return ""
  const known = ["ticket", "housing", "merch", "meal_plan", "other"]
  if (known.includes(category)) {
    return t(`passes.categories.${category}`)
  }
  // Fallback: capitalize first letter of raw string
  return category.charAt(0).toUpperCase() + category.slice(1)
}

/**
 * Returns the sort order for a given product category.
 * Lower numbers render first: ticket=0, housing=1, merch=2, other=3.
 * Unknown/patreon categories sort last (99).
 */
export function getCategoryOrder(category: string | null | undefined): number {
  switch (category) {
    case "ticket":
      return 0
    case "housing":
      return 1
    case "merch":
      return 2
    case "meal_plan":
      return 3
    case "other":
      return 4
    default:
      return 99
  }
}

/**
 * Array.sort comparator that orders ticket entries by their category priority.
 * Secondary ordering preserves the original backend serial (stable sort).
 */
export function compareByCategory(
  a: { product_category?: string | null },
  b: { product_category?: string | null },
): number {
  return (
    getCategoryOrder(a.product_category) - getCategoryOrder(b.product_category)
  )
}
