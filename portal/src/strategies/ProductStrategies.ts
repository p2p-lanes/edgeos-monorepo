import {
  getPriceStrategy,
  type PriceStrategy,
} from "@/strategies/PriceStrategy"
import type { AttendeePassState } from "@/types/Attendee"
import type { DiscountProps } from "@/types/discounts"
import type { ProductsPass } from "@/types/Products"

interface ProductStrategy {
  handleSelection: (
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
    discount?: DiscountProps,
  ) => AttendeePassState[]
}

class ExclusiveProductStrategy implements ProductStrategy {
  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
  ): AttendeePassState[] {
    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      const willBeSelected = !product?.selected

      return {
        ...attendee,
        products: attendee.products.map((p) => ({
          ...p,
          selected:
            p.id === product.id
              ? !p.selected
              : willBeSelected && !p.purchased
                ? false
                : p.selected,
        })),
      }
    })
  }
}

class PatreonProductStrategy implements ProductStrategy {
  private priceStrategy: PriceStrategy

  constructor() {
    this.priceStrategy = getPriceStrategy()
  }

  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
    discount?: DiscountProps,
  ): AttendeePassState[] {
    const isPatreonSelected = !product?.selected

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => ({
          ...p,
          selected:
            attendee.id === attendeeId && p.id === product.id
              ? !p.selected
              : p.selected,
          price: this.priceStrategy.calculatePrice(
            p,
            isPatreonSelected || false,
            discount?.discount_value || 0,
          ),
        })),
      }
    })
  }
}

class MonthProductStrategy implements ProductStrategy {
  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
  ): AttendeePassState[] {
    const isMonthSelected = product?.selected
    const willSelectMonth = !isMonthSelected

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => ({
          ...p,
          selected:
            p.id === product.id
              ? !p.selected
              : p.duration_type === "week" && !p.purchased
                ? willSelectMonth
                : p.selected,
        })),
      }
    })
  }
}

class WeekProductStrategy implements ProductStrategy {
  protected countActiveWeeks(products: ProductsPass[]): number {
    return products.filter(
      (p) => p.duration_type === "week" && (p.purchased || p.selected),
    ).length
  }

  protected hasEditedWeeks(products: ProductsPass[]): boolean {
    return products.some((p) => p.duration_type === "week" && p.edit)
  }

  protected shouldSelectMonth(
    activeWeeks: number,
    hasEditedWeeks: boolean,
    monthPurchased: boolean,
  ): boolean {
    if (monthPurchased) {
      return false
    }
    return activeWeeks >= 4 && !hasEditedWeeks
  }

  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
  ): AttendeePassState[] {
    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      const willBeSelected = !product.selected
      const monthProduct = attendee.products.find(
        (p) => p.duration_type === "month",
      )

      const updatedProducts = attendee.products.map((p) => ({
        ...p,
        selected: p.id === product.id ? willBeSelected : p.selected,
        edit:
          p.id === product.id ? product.purchased && willBeSelected : p.edit,
      }))

      const activeWeeks = this.countActiveWeeks(updatedProducts)
      const hasEdited = this.hasEditedWeeks(updatedProducts)
      const shouldSelectMonth = this.shouldSelectMonth(
        activeWeeks,
        hasEdited,
        monthProduct?.purchased || false,
      )

      return {
        ...attendee,
        products: updatedProducts.map((p) => ({
          ...p,
          quantity:
            p.duration_type === "day" && shouldSelectMonth && !p.purchased
              ? 0
              : p.quantity,
          selected:
            p.duration_type === "month"
              ? shouldSelectMonth
              : p.duration_type === "day" && shouldSelectMonth
                ? false
                : p.selected,
          edit: p.duration_type === "month" ? hasEdited : p.edit,
        })),
      }
    })
  }
}

class FullProductStrategy implements ProductStrategy {
  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
  ): AttendeePassState[] {
    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => ({
          ...p,
          selected: p.id === product.id ? !p.selected : p.selected,
        })),
      }
    })
  }
}

class DayProductStrategy implements ProductStrategy {
  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
  ): AttendeePassState[] {
    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => ({
          ...p,
          selected:
            p.id === product.id
              ? !!(
                  product.quantity &&
                  product.quantity - (p.original_quantity ?? 0) > 0
                )
              : p.selected,
          quantity: p.id === product.id ? product.quantity : p.quantity,
        })),
      }
    })
  }
}

/**
 * Wraps any strategy to deselect exclusive products when a non-exclusive
 * product is selected, ensuring mutual exclusivity works both ways.
 */
class ExclusivityGuard implements ProductStrategy {
  constructor(private inner: ProductStrategy) {}

  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
    discount?: DiscountProps,
  ): AttendeePassState[] {
    const result = this.inner.handleSelection(
      attendees,
      attendeeId,
      product,
      discount,
    )

    const willBeSelected = !product.selected
    if (!willBeSelected) return result

    return result.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee
      return {
        ...attendee,
        products: attendee.products.map((p) => ({
          ...p,
          selected: p.exclusive && !p.purchased ? false : p.selected,
        })),
      }
    })
  }
}

export const getProductStrategy = (
  product: ProductsPass,
  _isEditing: boolean,
): ProductStrategy => {
  if (product.exclusive) return new ExclusiveProductStrategy()

  if (product.category === "patreon") return new PatreonProductStrategy()

  const baseStrategy = (() => {
    switch (product.duration_type) {
      case "month":
        return new MonthProductStrategy()
      case "week":
        return new WeekProductStrategy()
      case "day":
        return new DayProductStrategy()
      case "full":
        return new FullProductStrategy()
      default:
        return new WeekProductStrategy()
    }
  })()

  return new ExclusivityGuard(baseStrategy)
}
