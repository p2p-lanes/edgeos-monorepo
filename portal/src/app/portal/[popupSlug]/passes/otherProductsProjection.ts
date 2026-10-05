import type { PaymentPortalPublic } from "@/client"

export interface OtherPurchasedProduct {
  id: string
  name: string
  quantity: number
  /** Category and door of the first purchase seen: what ties the product
   *  back to the checkout step it was sold from, for its icon. */
  category: string
  salesFlowId: string
}

export interface VisiblePassReference {
  id: string
  paymentId?: string | null
  productId: string
}

export function projectOtherPurchasedProducts(
  payments: PaymentPortalPublic[],
  applicationFlowIds: ReadonlySet<string>,
  visiblePasses: VisiblePassReference[],
): OtherPurchasedProduct[] {
  const products = new Map<string, OtherPurchasedProduct>()
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
      const paymentProductKey = `${payment.id}:${line.product_id}`
      const visibleQuantity =
        remainingVisibleQuantity.get(paymentProductKey) ?? 0
      const quantity = line.units?.length
        ? line.units.filter(
            (unit) => unit.active && !visiblePassIds.has(unit.id),
          ).length
        : Math.max(0, line.quantity - visibleQuantity)

      if (!line.units?.length && visibleQuantity > 0) {
        remainingVisibleQuantity.set(
          paymentProductKey,
          Math.max(0, visibleQuantity - line.quantity),
        )
      }

      if (quantity === 0) continue

      const existing = products.get(line.product_id)
      products.set(line.product_id, {
        id: line.product_id,
        name: existing?.name ?? line.product_name,
        quantity: (existing?.quantity ?? 0) + quantity,
        category: existing?.category ?? line.product_category,
        salesFlowId: existing?.salesFlowId ?? payment.sales_flow_id,
      })
    }
  }

  return [...products.values()]
}
