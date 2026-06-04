import {
  CHECKOUT_MODE,
  type CheckoutMode,
  getEffectiveCheckoutMode,
} from "@/checkout/popupCheckoutPolicy"
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
    // Strict scope: products in the SAME visual section as the clicked one.
    // Drives exclusivity (e.g. clicking a VIP clears a GA in the same section).
    exclusivityScopeIds?: string[],
    // Wide scope: every product visible to this attendee across ALL sections
    // currently rendered (post visible_if + attendee_categories filtering).
    // Drives auto-promotion (week → month) without leaking into products the
    // user can't see (e.g. Caregiver vs Nanny, opposite-tier locals).
    attendeeVisibleProductIds?: string[],
  ) => AttendeePassState[]
}

class PatreonProductStrategy implements ProductStrategy {
  private priceStrategy: PriceStrategy

  constructor(checkoutMode: CheckoutMode) {
    this.priceStrategy = getPriceStrategy(checkoutMode)
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
    const isMultiUnit = supportsQuantitySelector(product.max_per_order)
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
  protected inScope(p: ProductsPass, scopeIds: string[] | undefined): boolean {
    if (!scopeIds || scopeIds.length === 0) return true
    return scopeIds.includes(p.id)
  }

  protected countActiveWeeks(
    products: ProductsPass[],
    scopeIds: string[] | undefined,
  ): number {
    return products.filter(
      (p) =>
        p.duration_type === "week" &&
        (p.purchased || p.selected) &&
        this.inScope(p, scopeIds),
    ).length
  }

  protected hasEditedWeeks(
    products: ProductsPass[],
    scopeIds: string[] | undefined,
  ): boolean {
    return products.some(
      (p) => p.duration_type === "week" && p.edit && this.inScope(p, scopeIds),
    )
  }

  // The Month target to auto-promote. With a section scope the target MUST
  // live inside the same section as the weeks — otherwise we'd promote a Month
  // the user can't see (e.g. Month Locals when only regular weeks are visible).
  // Without scope, fall back to the first Month in the attendee (legacy).
  protected resolveMonthTarget(
    products: ProductsPass[],
    scopeIds: string[] | undefined,
  ): ProductsPass | undefined {
    if (scopeIds && scopeIds.length > 0) {
      return products.find(
        (p) => p.duration_type === "month" && scopeIds.includes(p.id),
      )
    }
    return products.find((p) => p.duration_type === "month")
  }

  // Threshold: with scope, all weeks in that scope; without, legacy "4 weeks".
  protected weeksInScopeCount(
    products: ProductsPass[],
    scopeIds: string[] | undefined,
  ): number {
    if (scopeIds && scopeIds.length > 0) {
      return products.filter(
        (p) => p.duration_type === "week" && scopeIds.includes(p.id),
      ).length
    }
    return 4
  }

  protected shouldSelectMonth(
    activeWeeks: number,
    weeksThreshold: number,
    hasEditedWeeks: boolean,
    monthTargetExists: boolean,
    monthPurchased: boolean,
  ): boolean {
    if (!monthTargetExists) return false
    if (monthPurchased) return false
    if (weeksThreshold === 0) return false
    return activeWeeks >= weeksThreshold && !hasEditedWeeks
  }

  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
    _discount?: DiscountProps,
    exclusivityScopeIds?: string[],
    attendeeVisibleProductIds?: string[],
  ): AttendeePassState[] {
    const isMultiUnit = supportsQuantitySelector(product.max_per_order)

    // Promotion scope: prefer the WIDE scope (all attendee-visible products
    // across sections) so a week-in-section-A can promote a month-in-section-B
    // when both belong to the same coherent set the user actually sees.
    // Fall back to the strict section scope to keep behaviour stable for
    // configs that don't provide visibility hints.
    const promotionScope =
      attendeeVisibleProductIds && attendeeVisibleProductIds.length > 0
        ? attendeeVisibleProductIds
        : exclusivityScopeIds

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      const willBeSelected = isMultiUnit
        ? (product.quantity ?? 0) > 0
        : !product.selected

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

      const monthTarget = this.resolveMonthTarget(
        updatedProducts,
        promotionScope,
      )
      const activeWeeks = this.countActiveWeeks(updatedProducts, promotionScope)
      const hasEdited = this.hasEditedWeeks(updatedProducts, promotionScope)
      const weeksThreshold = this.weeksInScopeCount(
        updatedProducts,
        promotionScope,
      )
      const shouldSelectMonth = this.shouldSelectMonth(
        activeWeeks,
        weeksThreshold,
        hasEdited,
        !!monthTarget,
        monthTarget?.purchased || false,
      )

      const isClearedByMonth = (p: ProductsPass): boolean => {
        if (!shouldSelectMonth) return false
        if (p.purchased) return false
        if (p.duration_type !== "day" && p.duration_type !== "week")
          return false
        // Use the same scope used to decide the promotion so we only clear
        // products that belong to the same "visible set". Without scope hints,
        // legacy behaviour clears all week/day products of the attendee.
        return this.inScope(p, promotionScope)
      }

      return {
        ...attendee,
        products: updatedProducts.map((p) => {
          const isTargetMonth = !!monthTarget && p.id === monthTarget.id
          return {
            ...p,
            quantity: isClearedByMonth(p) ? 0 : p.quantity,
            selected: isTargetMonth
              ? shouldSelectMonth
              : isClearedByMonth(p)
                ? false
                : p.selected,
            edit: isTargetMonth ? hasEdited : p.edit,
          }
        }),
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
    const isMultiUnit = supportsQuantitySelector(product.max_per_order)

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
      supportsQuantitySelector(product.max_per_order)
    ) {
      return (product.quantity ?? 0) > 0
    }
    return false
  }

  private clearSelection(product: ProductsPass): ProductsPass {
    const usesQuantity =
      product.duration_type === "day" ||
      supportsQuantitySelector(product.max_per_order)

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
    exclusivityScopeIds?: string[],
    attendeeVisibleProductIds?: string[],
  ): AttendeePassState[] {
    const result = this.inner.handleSelection(
      attendees,
      attendeeId,
      product,
      discount,
      exclusivityScopeIds,
      attendeeVisibleProductIds,
    )

    // Scope: explicit ids from the caller (ticketing-step section) when provided,
    // otherwise fall back to the same product.category so a ticket exclusive
    // never clears a housing/merch selection.
    const inScope = (p: ProductsPass): boolean => {
      if (exclusivityScopeIds && exclusivityScopeIds.length > 0) {
        return exclusivityScopeIds.includes(p.id)
      }
      return p.category === product.category
    }

    return result.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      const updatedTarget = attendee.products.find((p) => p.id === product.id)
      if (!updatedTarget || !this.isActive(updatedTarget)) return attendee

      return {
        ...attendee,
        products: attendee.products.map((p) => {
          if (p.id === updatedTarget.id || p.purchased) return p
          if (!inScope(p)) return p

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
  private inScope(p: ProductsPass, scopeIds: string[] | undefined): boolean {
    if (!scopeIds || scopeIds.length === 0) return true
    return scopeIds.includes(p.id)
  }

  // The auto-promotion target when the full week set is completed. Only a
  // Month qualifies — a Full pass is a distinct product (full-event access,
  // not "4 weeks"), so it never auto-upgrades from weeks. It can still be
  // chosen explicitly via a direct click (handled in handleSelection). This
  // mirrors WeekProductStrategy in normal checkout, which also targets Month.
  private resolveMonthTarget(
    products: ProductsPass[],
    scopeIds: string[] | undefined,
  ): ProductsPass | undefined {
    return products.find(
      (p) =>
        p.duration_type === "month" &&
        !p.purchased &&
        this.inScope(p, scopeIds),
    )
  }

  // A week counts toward the month when it stays in the order: an owned week
  // that is kept (not given up for credit) OR a newly added selected week.
  private activeWeekCount(
    products: ProductsPass[],
    scopeIds: string[] | undefined,
  ): number {
    return products.filter(
      (p) =>
        p.duration_type === "week" &&
        this.inScope(p, scopeIds) &&
        ((p.purchased && !p.edit) || (!p.purchased && p.selected)),
    ).length
  }

  // Threshold: with scope, all weeks in that scope; without, legacy "4 weeks".
  private weeksThreshold(
    products: ProductsPass[],
    scopeIds: string[] | undefined,
  ): number {
    if (scopeIds && scopeIds.length > 0) {
      return products.filter(
        (p) => p.duration_type === "week" && scopeIds.includes(p.id),
      ).length
    }
    return 4
  }

  // Collapse the weekly/day passes into the month: select the month, give up
  // owned weeks/days for credit, and drop newly added ones, so the price
  // becomes (month - credit). Shared by the direct month click and the
  // week-completion auto-promotion. The month target also gets a quantity so
  // quantity-based month/full tiles (max_per_order null/>1) render as selected.
  private upgradeToMonth(
    products: ProductsPass[],
    monthId: string,
    scopeIds: string[] | undefined,
  ): ProductsPass[] {
    return products.map((p) => {
      if (p.id === monthId) {
        const quantity = supportsQuantitySelector(p.max_per_order)
          ? Math.max(1, p.quantity ?? 0)
          : p.quantity
        return { ...p, selected: true, quantity }
      }
      if (p.duration_type !== "week" && p.duration_type !== "day") return p
      if (!this.inScope(p, scopeIds)) return p
      if (p.purchased) return { ...p, edit: true, selected: false }
      return { ...p, selected: false, quantity: 0 }
    })
  }

  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
    _discount?: DiscountProps,
    exclusivityScopeIds?: string[],
    attendeeVisibleProductIds?: string[],
  ): AttendeePassState[] {
    const scope =
      attendeeVisibleProductIds && attendeeVisibleProductIds.length > 0
        ? attendeeVisibleProductIds
        : exclusivityScopeIds

    const isMonthLike =
      product.duration_type === "month" || product.duration_type === "full"
    // Day passes and multi-unit products (max_per_order null/>1) are driven by
    // quantity, not a plain selected toggle — the caller passes the new value.
    const usesQuantity =
      product.duration_type === "day" ||
      supportsQuantitySelector(product.max_per_order)

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee
      const products = attendee.products

      // Direct month/full click while editing: select → upgrade, deselect →
      // revert owned weeks/days back to kept (the newly added ones stay off).
      if (isMonthLike && !product.purchased) {
        const willSelect = usesQuantity
          ? (product.quantity ?? 0) > 0
          : !product.selected
        if (willSelect) {
          return {
            ...attendee,
            products: this.upgradeToMonth(products, product.id, scope),
          }
        }
        return {
          ...attendee,
          products: products.map((p) => {
            if (p.id === product.id)
              return {
                ...p,
                selected: false,
                quantity: usesQuantity ? 0 : p.quantity,
              }
            if (p.duration_type !== "week" && p.duration_type !== "day")
              return p
            if (!this.inScope(p, scope)) return p
            if (p.purchased) return { ...p, edit: false, selected: true }
            return p
          }),
        }
      }

      // Toggle the clicked product with edit semantics. Quantity-based products
      // (day passes, multi-unit) follow the new quantity the caller sent.
      const toggled = products.map((p) => {
        if (p.id !== product.id) return p
        if (usesQuantity) {
          const nextQuantity = Math.max(0, product.quantity ?? 0)
          return { ...p, quantity: nextQuantity, selected: nextQuantity > 0 }
        }
        if (p.purchased) {
          // Toggle edit flag: give up for credit
          return { ...p, edit: !p.edit, selected: !p.edit }
        }
        // Non-purchased: toggle selection
        return { ...p, selected: !p.selected }
      })

      // Auto-promote to month once the full week set is active again — mirrors
      // WeekProductStrategy in normal checkout, which is bypassed while editing.
      const monthTarget = this.resolveMonthTarget(toggled, scope)
      const threshold = this.weeksThreshold(toggled, scope)
      if (
        monthTarget &&
        threshold > 0 &&
        this.activeWeekCount(toggled, scope) >= threshold
      ) {
        return {
          ...attendee,
          products: this.upgradeToMonth(toggled, monthTarget.id, scope),
        }
      }

      return { ...attendee, products: toggled }
    })
  }
}

class SimpleQuantityProductStrategy implements ProductStrategy {
  handleSelection(
    attendees: AttendeePassState[],
    attendeeId: string,
    product: ProductsPass,
  ): AttendeePassState[] {
    const usesQuantity =
      product.duration_type === "day" ||
      supportsQuantitySelector(product.max_per_order)

    return attendees.map((attendee) => {
      if (attendee.id !== attendeeId) return attendee

      return {
        ...attendee,
        products: attendee.products.map((currentProduct) => {
          if (currentProduct.id !== product.id) return currentProduct

          if (usesQuantity) {
            const nextQuantity = Math.max(0, product.quantity ?? 0)
            return {
              ...currentProduct,
              quantity: nextQuantity,
              selected: nextQuantity > 0,
            }
          }

          return {
            ...currentProduct,
            selected: !currentProduct.selected,
          }
        }),
      }
    })
  }
}

export const getProductStrategy = (
  product: ProductsPass,
  isEditing: boolean,
  checkoutMode: CheckoutMode = CHECKOUT_MODE.PASS_SYSTEM,
): ProductStrategy => {
  if (isEditing) return new EditProductStrategy()

  const effective = getEffectiveCheckoutMode(product.category, checkoutMode)

  if (effective === CHECKOUT_MODE.SIMPLE_QUANTITY) {
    return new SimpleQuantityProductStrategy()
  }

  const baseStrategy = (() => {
    if (product.category === "patreon") {
      return new PatreonProductStrategy(checkoutMode)
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
