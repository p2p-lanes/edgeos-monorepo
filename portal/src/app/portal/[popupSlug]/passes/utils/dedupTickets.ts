/**
 * Collapses physically-duplicated `attendee_products` rows that share the
 * same `product_id` in the "Your Passes" view.
 *
 * Root cause: a historical bug created two `attendee_products` rows for the
 * same `(attendee_id, product_id)` pair (double Payment APPROVED). The
 * migration `4dffd7a49bef` documents this without cleaning the rows. The
 * BO admin still needs to see each physical row individually (check-in
 * lists, counts), so the backend keeps returning all of them — the portal
 * collapses the duplicates only for the public passes view.
 *
 * Exception: some product categories legitimately produce multiple rows
 * per `product_id`. For those we keep every row:
 *   - `duration_type === "day"`: a multi-day attendee gets one row per
 *     attended day (see `backend/app/api/payment/crud.py:1986-2021`).
 *   - `product_category === "meal_plan"`: multi-day meal plans store one
 *     row per day with `purchase_metadata` carrying the menu selection
 *     (see `backend/tests/api/payment/test_meal_plan_purchase_metadata.py`).
 *
 * Within a collapsed group we prefer:
 *   1. A row with `last_scan_at` set (already used → most authoritative QR).
 *   2. A row with a non-falsy `product_category` (defensive — almost never
 *      hits after the backend `_build_attendee_with_origin` fix).
 *   3. The first row encountered (stable order).
 */
export function dedupTicketEntries<
  T extends {
    product_id: string
    product_category?: string | null
    duration_type?: string | null
    last_scan_at?: string | null
  },
>(entries: T[]): T[] {
  if (entries.length === 0) return entries

  const groups = new Map<string, T[]>()
  const order: string[] = []
  for (const entry of entries) {
    const bucket = groups.get(entry.product_id)
    if (bucket) {
      bucket.push(entry)
    } else {
      groups.set(entry.product_id, [entry])
      order.push(entry.product_id)
    }
  }

  const result: T[] = []
  for (const productId of order) {
    const group = groups.get(productId)
    if (!group) continue

    const isLegitimateMulti = group.some(
      (e) => e.duration_type === "day" || e.product_category === "meal_plan",
    )
    if (isLegitimateMulti || group.length === 1) {
      result.push(...group)
      continue
    }

    const scanned = group.find((e) => e.last_scan_at != null)
    if (scanned) {
      result.push(scanned)
      continue
    }
    const withCategory = group.find(
      (e) => e.product_category != null && e.product_category !== "",
    )
    result.push(withCategory ?? group[0])
  }

  return result
}
