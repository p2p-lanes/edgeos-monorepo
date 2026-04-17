import {
  CHECKOUT_MODE,
  type CheckoutMode,
} from "@/checkout/popupCheckoutPolicy"
import type { ProductsPass } from "@/types/Products"

interface PurchaseStrategy {
  applyPurchaseRules: (
    products: ProductsPass[],
    attendeeProducts: ProductsPass[],
  ) => ProductsPass[]
}

class DefaultPurchaseStrategy implements PurchaseStrategy {
  constructor(private readonly checkoutMode: CheckoutMode) {}

  applyPurchaseRules(
    products: ProductsPass[],
    attendeeProducts: ProductsPass[],
  ): ProductsPass[] {
    const hasMonthlyPass =
      this.checkoutMode === CHECKOUT_MODE.PASS_SYSTEM &&
      attendeeProducts?.some((p) => p.duration_type === "month")

    return products.map((product) => ({
      ...product,
      purchased:
        attendeeProducts?.some((p) => p.id === product.id) ||
        (hasMonthlyPass && product.duration_type === "week"),
    }))
  }
}

export const getPurchaseStrategy = (
  checkoutMode: CheckoutMode = CHECKOUT_MODE.PASS_SYSTEM,
): PurchaseStrategy => {
  return new DefaultPurchaseStrategy(checkoutMode)
}
