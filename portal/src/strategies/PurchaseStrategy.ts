import type { ProductsPass } from "@/types/Products"

interface PurchaseStrategy {
  applyPurchaseRules: (
    products: ProductsPass[],
    attendeeProducts: ProductsPass[],
  ) => ProductsPass[]
}

class DefaultPurchaseStrategy implements PurchaseStrategy {
  applyPurchaseRules(
    products: ProductsPass[],
    attendeeProducts: ProductsPass[],
  ): ProductsPass[] {
    const hasMonthlyPass = attendeeProducts?.some(
      (p) => p.duration_type === "month",
    )

    return products.map((product) => ({
      ...product,
      purchased:
        attendeeProducts?.some((p) => p.id === product.id) ||
        (hasMonthlyPass && product.duration_type === "week"),
    }))
  }
}

export const getPurchaseStrategy = (): PurchaseStrategy => {
  return new DefaultPurchaseStrategy()
}
