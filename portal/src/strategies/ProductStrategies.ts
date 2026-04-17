import { supportsQuantitySelector } from "@/components/ui/QuantitySelector"
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
    const isMultiUnit = supportsQuantitySelector(product.max_quantity)
    // For multi-unit products, the caller passes the NEW desired quantity in
    // `product.quantity`. The selection is active when quantity > 0.
    const willSelectMonth = isMultiUnit
      ? (product.quantity ?? 0) > 0
      : !product?.selected

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => {
          if (p.id === product.id) {
            if (isMultiUnit) {
              const nextQuantity = Math.max(0, product.quantity ?? 0)
              return {
                ...p,
                quantity: nextQuantity,
                selected: nextQuantity > 0,
              }
            }
            return { ...p, selected: !p.selected }
          }
          return {
            ...p,
            selected:
              p.duration_type === "week" && !p.purchased && willSelectMonth
                ? false
                : p.selected,
            quantity:
              p.duration_type === "day" && !p.purchased && willSelectMonth
                ? 0
                : p.quantity,
          }
        }),
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
    const isMultiUnit = supportsQuantitySelector(product.max_quantity)

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      const willBeSelected = isMultiUnit
        ? (product.quantity ?? 0) > 0
        : !product.selected
      const monthProduct = attendee.products.find(
        (p) => p.duration_type === "month",
      )

      const updatedProducts = attendee.products.map((p) => {
        if (p.id !== product.id) return p
        if (isMultiUnit) {
          const nextQuantity = Math.max(0, product.quantity ?? 0)
          return {
            ...p,
            quantity: nextQuantity,
            selected: nextQuantity > 0,
          }
        }
        return {
          ...p,
          selected: willBeSelected,
          edit: product.purchased && willBeSelected ? true : p.edit,
        }
      })

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
    const isMultiUnit = supportsQuantitySelector(product.max_quantity)

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => {
          if (p.id !== product.id) return p
          if (isMultiUnit) {
            const nextQuantity = Math.max(0, product.quantity ?? 0)
            return {
              ...p,
              quantity: nextQuantity,
              selected: nextQuantity > 0,
            }
          }
          return { ...p, selected: !p.selected }
        }),
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

class ExclusivityGuard implements ProductStrategy {
  constructor(private inner: ProductStrategy) {}

  private isActive(product: ProductsPass): boolean {
    if (product.purchased) return true
    if (product.selected) return true
    if (
      product.duration_type === "day" ||
      supportsQuantitySelector(product.max_quantity)
    ) {
      return (product.quantity ?? 0) > 0
    }
    return false
  }

  private clearSelection(product: ProductsPass): ProductsPass {
    const usesQuantity =
      product.duration_type === "day" ||
      supportsQuantitySelector(product.max_quantity)

    return {
      ...product,
      selected: false,
      quantity: usesQuantity ? 0 : product.quantity,
    }
  }

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

    return result.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      const updatedTarget = attendee.products.find((p) => p.id === product.id)
      if (!updatedTarget || !this.isActive(updatedTarget)) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => {
          if (p.id === updatedTarget.id || p.purchased) return p

          if (updatedTarget.exclusive) {
            return this.clearSelection(p)
          }

          if (p.exclusive) {
            return this.clearSelection(p)
          }

          return p
        }),
      }
    })
  }
}

class EditProductStrategy implements ProductStrategy {
  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
  ): AttendeePassState[] {
    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => {
          if (p.id !== product.id) return p

          if (p.purchased) {
            // Toggle edit flag: give up for credit
            return { ...p, edit: !p.edit, selected: !p.edit }
          }

          // Non-purchased: toggle selection
          return { ...p, selected: !p.selected }
        }),
      }
    })
  }
}

export const getProductStrategy = (
  product: ProductsPass,
  isEditing: boolean,
): ProductStrategy => {
  if (isEditing) return new EditProductStrategy()

  const baseStrategy = (() => {
    if (product.category === "patreon") {
      return new PatreonProductStrategy()
    }

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
