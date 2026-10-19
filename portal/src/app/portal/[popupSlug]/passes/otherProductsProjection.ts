import type { PaymentPortalPublic } from "@/client"

/** One purchased unit in "Other products": each gets its own row. */
export interface OtherPurchasedProduct {
  /** Stable row key: the unit id, or a synthetic one for legacy lines. */
  key: string
  /** The specific purchase whose answers this unit belongs to. */
  paymentId?: string
  /** Product id. */
  id: string
  name: string
  /** Category and door of the first purchase seen: what ties the product
   *  back to the checkout step it was sold from, for its icon. */
  category: string
  salesFlowId: string
  /** Code to show at a desk; null when this unit has no QR. */
  checkInCode: string | null
  /** Most recent scan of the QR; null while it is unused. */
  lastScanAt: string | null
  /** 1-based position among the rows of the same product, and their count. */
  number: number
  total: number
}

export interface VisiblePassReference {
  id: string
  paymentId?: string | null
  productId: string
}

type ProductOrigin = Pick<OtherPurchasedProduct, "name" | "category"> & {
  salesFlowId: string
}

export function projectOtherPurchasedProducts(
  payments: PaymentPortalPublic[],
  applicationFlowIds: ReadonlySet<string>,
  visiblePasses: VisiblePassReference[],
): OtherPurchasedProduct[] {
  const items: Array<Omit<OtherPurchasedProduct, "number" | "total">> = []
  const origins = new Map<string, ProductOrigin>()
  const visiblePassIds = new Set(visiblePasses.map((pass) => pass.id))
  const remainingVisibleQuantity = new Map<string, number>()
  for (const pass of visiblePasses) {
    if (!pass.paymentId) continue
    const key = `${pass.paymentId}:${pass.productId}`
    remainingVisibleQuantity.set(
      key,
      (remainingVisibleQuantity.get(key) ?? 0) + 1,
    )
  }

  for (const payment of payments) {
    if (
      payment.status !== "approved" ||
      payment.application_id != null ||
      payment.sales_flow_id == null ||
      applicationFlowIds.has(payment.sales_flow_id)
    ) {
      continue
    }

    for (const line of payment.products_snapshot ?? []) {
      // The first purchase seen names the product and picks its icon.
      if (!origins.has(line.product_id)) {
        origins.set(line.product_id, {
          name: line.product_name,
          category: line.product_category,
          salesFlowId: payment.sales_flow_id,
        })
      }
      const origin = origins.get(line.product_id)!

      if (line.units?.length) {
        for (const unit of line.units) {
          if (!unit.active || visiblePassIds.has(unit.id)) continue
          const scannable = unit.requires_check_in && !!unit.check_in_code
          items.push({
            key: unit.id,
            paymentId: payment.id,
            id: line.product_id,
            ...origin,
            checkInCode: scannable ? unit.check_in_code : null,
            lastScanAt: scannable ? (unit.last_scan_at ?? null) : null,
          })
        }
        continue
      }

      // Legacy lines carry no units: one row per purchased quantity, less
      // whatever already shows up as a pass.
      const paymentProductKey = `${payment.id}:${line.product_id}`
      const visibleQuantity =
        remainingVisibleQuantity.get(paymentProductKey) ?? 0
      if (visibleQuantity > 0) {
        remainingVisibleQuantity.set(
          paymentProductKey,
          Math.max(0, visibleQuantity - line.quantity),
        )
      }
      const quantity = Math.max(0, line.quantity - visibleQuantity)
      for (let index = 0; index < quantity; index++) {
        items.push({
          key: `${paymentProductKey}:${index}`,
          paymentId: payment.id,
          id: line.product_id,
          ...origin,
          checkInCode: null,
          lastScanAt: null,
        })
      }
    }
  }

  const totals = new Map<string, number>()
  for (const item of items) totals.set(item.id, (totals.get(item.id) ?? 0) + 1)
  const seen = new Map<string, number>()
  const numbered = items.map((item) => {
    const number = (seen.get(item.id) ?? 0) + 1
    seen.set(item.id, number)
    return { ...item, number, total: totals.get(item.id) ?? 1 }
  })

  // What can still be used goes first; used QRs sink to the bottom.
  return numbered
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        Number(a.item.lastScanAt != null) - Number(b.item.lastScanAt != null) ||
        a.index - b.index,
    )
    .map(({ item }) => item)
}
