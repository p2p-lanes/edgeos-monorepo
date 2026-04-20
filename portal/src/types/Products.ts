import type { ProductPublic, TierGroupPublic, TierPhasePublic } from "@/client"

/**
 * Portal-specific extension of ProductPublic.
 * - price: overridden to number (API returns string for Decimal precision; portal converts)
 * - compare_price: same treatment
 * - category: string (portal uses more specific categories than API spec)
 * - tier_group / phase: optional enrichment fields from ProductPublicWithTier; null for ungrouped products
 */
export type ProductsPass = Omit<
  ProductPublic,
  "price" | "compare_price" | "category"
> & {
  price: number
  compare_price?: number | null
  category: string
  selected?: boolean
  edit?: boolean
  purchased?: boolean
  attendee_id?: string
  quantity?: number
  original_price?: number
  disabled?: boolean
  original_quantity?: number
  /** Tier group this product belongs to. null/undefined for ungrouped legacy products. */
  tier_group?: TierGroupPublic | null
  /** The phase row for this product within its tier group. null/undefined for ungrouped products. */
  phase?: TierPhasePublic | null
}
