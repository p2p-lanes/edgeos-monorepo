import {
  CHECKOUT_MODE,
  type CheckoutMode,
  TICKET_CATEGORY,
} from "@/checkout/popupCheckoutPolicy"
import type { AttendeePassState } from "@/types/Attendee"
import type { DiscountProps } from "@/types/discounts"
import type { ProductsPass } from "@/types/Products"

interface TotalResult {
  total: number
  originalTotal: number
  discountAmount: number
}
interface PriceCalculationStrategy {
  calculate(products: ProductsPass[], discount: DiscountProps): TotalResult
}

abstract class BasePriceStrategy implements PriceCalculationStrategy {
  protected calculateOriginalTotal(products: ProductsPass[]): number {
    return products
      .filter((p) => p.selected)
      .reduce((sum, product) => {
        const price = product.original_price ?? 0

        if (product.purchased) {
          const diff =
            (product.quantity || 1) - (product.original_quantity || 1)
          return diff > 0 ? sum + price * diff : sum
        }

        return sum + price * (product.quantity || 1)
      }, 0)
  }

  abstract calculate(
    products: ProductsPass[],
    discount: DiscountProps,
  ): TotalResult
}

class MonthlyPriceStrategy extends BasePriceStrategy {
  calculate(products: ProductsPass[], discount: DiscountProps): TotalResult {
    const hasPatreon = products.some(
      (p) => p.category === "patreon" && p.selected,
    )
    const monthProduct = products.find(
      (p) => p.duration_type === "month" && p.selected && !p.purchased,
    )
    const monthPrice =
      (monthProduct?.price ?? 0) * (monthProduct?.quantity ?? 1)
    const totalProductsPurchased = products
      .filter((p) => p.category !== "patreon")
      .reduce(
        (sum, product) =>
          sum +
          (product.purchased ? product.price * (product.quantity ?? 1) : 0),
        0,
      )

    const originalTotal = this.calculateOriginalTotal(products)
    const discountAmount = discount.discount_value
      ? originalTotal * (discount.discount_value / 100)
      : 0

    return {
      total:
        monthPrice -
        (hasPatreon && monthProduct?.attendee_category !== "main"
          ? 0
          : totalProductsPurchased),
      originalTotal: originalTotal,
      discountAmount: discountAmount,
    }
  }

  protected calculateOriginalTotal(products: ProductsPass[]): number {
    return (
      products.find((p) => p.selected && p.duration_type === "month")
        ?.original_price ?? 0
    )
  }
}

class WeeklyPriceStrategy extends BasePriceStrategy {
  calculate(products: ProductsPass[], discount: DiscountProps): TotalResult {
    const weekSelectedProducts = products.filter(
      (p) =>
        (p.duration_type === "week" ||
          p.duration_type === "full" ||
          p.duration_type === "day") &&
        p.selected,
    )

    const totalSelected = weekSelectedProducts.reduce((sum, product) => {
      if (product.purchased && product.duration_type !== "day") {
        return sum - (product.price ?? 0) * (product.quantity || 1)
      }

      if (product.duration_type === "day") {
        if (product.purchased) {
          const diff =
            (product.quantity || 1) - (product.original_quantity || 1)
          return diff > 0 ? sum + (product.price ?? 0) * diff : sum
        }
        return sum + (product.price ?? 0) * (product.quantity || 1)
      }

      return sum + (product.price ?? 0) * (product.quantity || 1)
    }, 0)

    const originalTotal = this.calculateOriginalTotal(products)
    const discountAmount = discount.discount_value
      ? originalTotal * (discount.discount_value / 100)
      : 0

    return {
      total: totalSelected,
      originalTotal: originalTotal,
      discountAmount: discountAmount,
    }
  }
}

class PatreonPriceStrategy extends BasePriceStrategy {
  calculate(products: ProductsPass[], _discount: DiscountProps): TotalResult {
    const patreonProduct = products.find(
      (p) => p.category === "patreon" && p.selected,
    )
    const productsSelected = products.filter(
      (p) => p.selected && !p.purchased && p.category !== "patreon",
    )
    const patreonPrice =
      (patreonProduct?.price ?? 0) * (patreonProduct?.quantity ?? 1)
    const originalTotal = this.calculateOriginalTotal(products)
    const discountAmount = productsSelected.reduce(
      (sum, product) =>
        sum + (product.original_price ?? 0) * (product.quantity ?? 1),
      0,
    )

    return {
      total: patreonPrice,
      originalTotal: originalTotal,
      discountAmount: discountAmount,
    }
  }
}

class MonthlyPurchasedPriceStrategy extends BasePriceStrategy {
  calculate(products: ProductsPass[], _discount: DiscountProps): TotalResult {
    const someSelectedWeek = products.some(
      (p) => p.selected && p.duration_type === "week",
    )

    if (!someSelectedWeek) {
      return {
        total: 0,
        originalTotal: 0,
        discountAmount: 0,
      }
    }

    const monthProductPurchased = products.find(
      (p) => p.duration_type === "month" && p.purchased,
    )
    const weekProductsPurchased = products.filter(
      (p) => p.duration_type === "week" && p.purchased && !p.selected,
    )

    const totalWeekPurchased = weekProductsPurchased.reduce(
      (sum, product) => sum + product.price * (product.quantity ?? 1),
      0,
    )

    const originalTotal = this.calculateOriginalTotal(products)

    return {
      total:
        totalWeekPurchased -
        (monthProductPurchased?.price ?? 0) *
          (monthProductPurchased?.quantity ?? 1),
      originalTotal: originalTotal,
      discountAmount: 0,
    }
  }
}

class SimpleQuantityPriceStrategy extends BasePriceStrategy {
  calculate(products: ProductsPass[], _discount: DiscountProps): TotalResult {
    const total = products
      .filter((product) => product.selected)
      .reduce((sum, product) => {
        const quantity = product.quantity ?? 1
        const originalQuantity = product.original_quantity ?? 0

        if (product.purchased && product.duration_type === "day") {
          return sum + product.price * Math.max(0, quantity - originalQuantity)
        }

        if (product.purchased && !product.edit) {
          return sum
        }

        return sum + product.price * quantity
      }, 0)

    return {
      total,
      originalTotal: total,
      discountAmount: 0,
    }
  }
}

// Calculadora de totales
export class TotalCalculator {
  constructor(
    private readonly checkoutMode: CheckoutMode = CHECKOUT_MODE.PASS_SYSTEM,
  ) {}

  calculate(
    attendees: AttendeePassState[],
    discount: DiscountProps,
    groupDiscountPercentage?: number,
  ): TotalResult {
    const baseResult = attendees.reduce(
      (total, attendee) => {
        const ticketProducts = attendee.products.filter(
          (p) => p.category === TICKET_CATEGORY || p.category === "patreon",
        )
        const nonTicketProducts = attendee.products.filter(
          (p) => p.category !== TICKET_CATEGORY && p.category !== "patreon",
        )

        const ticketStrategy = this.getStrategy(ticketProducts)
        const ticketResult = ticketStrategy.calculate(ticketProducts, discount)

        const nonTicketResult =
          nonTicketProducts.length > 0
            ? new SimpleQuantityPriceStrategy().calculate(
                nonTicketProducts,
                discount,
              )
            : { total: 0, originalTotal: 0, discountAmount: 0 }

        return {
          total: total.total + ticketResult.total + nonTicketResult.total,
          originalTotal:
            total.originalTotal +
            ticketResult.originalTotal +
            nonTicketResult.originalTotal,
          discountAmount:
            total.discountAmount +
            ticketResult.discountAmount +
            nonTicketResult.discountAmount,
        }
      },
      { total: 0, originalTotal: 0, discountAmount: 0 },
    )

    if (groupDiscountPercentage && groupDiscountPercentage > 0) {
      const groupDiscountAmount =
        baseResult.originalTotal * (groupDiscountPercentage / 100)
      const individualDiscountAmount = baseResult.discountAmount

      if (groupDiscountAmount > individualDiscountAmount) {
        return {
          total: baseResult.originalTotal - groupDiscountAmount,
          originalTotal: baseResult.originalTotal,
          discountAmount: groupDiscountAmount,
        }
      }
    }

    return baseResult
  }

  private getStrategy(products: ProductsPass[]): PriceCalculationStrategy {
    if (this.checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY) {
      return new SimpleQuantityPriceStrategy()
    }

    const hasPatreon = products.some(
      (p) => p.category === "patreon" && p.selected,
    )
    const hasMonthly = products.some(
      (p) => p.duration_type === "month" && p.selected,
    )
    const hasMonthPurchased = products.some(
      (p) => p.duration_type === "month" && p.purchased,
    )

    if (hasPatreon) return new PatreonPriceStrategy()
    if (hasMonthly) return new MonthlyPriceStrategy()
    if (hasMonthPurchased) return new MonthlyPurchasedPriceStrategy()
    return new WeeklyPriceStrategy()
  }
}
