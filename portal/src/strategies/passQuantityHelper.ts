import { supportsQuantitySelector } from "@/components/ui/QuantitySelector"
import type { ProductsPass } from "@/types/Products"

/**
 * Returns true when a pass-system product is driven by quantity (stepper UI)
 * rather than a single-select toggle.
 *
 * Rules (pass_system only — do NOT use on simple_quantity/open-checkout paths):
 * - `day` passes are ALWAYS quantity-based (the stepper maps to number of days).
 * - `full` and `month` passes are ALWAYS single-select, regardless of
 *   max_per_order. A full pass with max_per_order=null means "one per order,
 *   unrestricted in stock", NOT "can add multiple units".
 * - All other duration types (week, or custom) are quantity-based when
 *   max_per_order is null or > 1 (same rule as supportsQuantitySelector).
 */
export function isPassQuantityBased(product: ProductsPass): boolean {
  const { duration_type, max_per_order } = product

  if (duration_type === "day") return true
  if (duration_type === "full" || duration_type === "month") return false

  return supportsQuantitySelector(max_per_order)
}
