import { useMemo } from "react"
import type {
  CheckoutCartSummary,
  SelectedDynamicItem,
  SelectedHousingItem,
  SelectedMealPlanItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"

// Mirror backend `_calculate_amounts` (payment/crud.py): every product is
// discountable unless the admin set `discountable: false`. Patreon products
// are forced to `discountable: false` by the backend schema validator, so the
// single check covers both cases.
function isNonDiscountableProduct(product: {
  discountable?: boolean | null
}): boolean {
  return product.discountable === false
}

interface UseCartSummaryParams {
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  mealPlans: SelectedMealPlanItem[]
  /**
   * Items added through templated checkout steps (modern popups). Keyed by
   * step_type; each item carries its product so we can split by category
   * (patreon items and `discountable=false` products bypass the discount).
   */
  dynamicItems: Record<string, SelectedDynamicItem[]>
  insuranceAmount: number
  /**
   * Contribution fee amount in absolute currency units.
   * Source from popup config only — never recompute client-side from a
   * percentage; the backend is the single source of truth for the rate.
   */
  contributionAmount: number
  isEditing: boolean
  editCredit: number
  monthUpgradeCredit: number
  appCredit: string | number | null | undefined
  discountValue: number
}

export function useCartSummary({
  selectedPasses,
  housing,
  merch,
  patron,
  mealPlans,
  dynamicItems,
  insuranceAmount,
  contributionAmount,
  isEditing,
  editCredit,
  monthUpgradeCredit,
  appCredit,
  discountValue,
}: UseCartSummaryParams) {
  const summary = useMemo<CheckoutCartSummary>(() => {
    const passesSubtotal = selectedPasses.reduce((sum, p) => sum + p.price, 0)
    const passesOriginalSubtotal = selectedPasses.reduce(
      (sum, p) => sum + (p.originalPrice ?? p.price),
      0,
    )
    // Split by `isNonDiscountableProduct` so patreon donations and admin-flagged
    // `discountable: false` products (e.g. mandatory meal plans) skip the
    // discount and stay at full price.
    const nonDiscountablePassesSubtotal = selectedPasses
      .filter((p) => isNonDiscountableProduct(p.product))
      .reduce((sum, p) => sum + (p.originalPrice ?? p.price), 0)
    const discountablePassesSubtotal =
      passesOriginalSubtotal - nonDiscountablePassesSubtotal

    const housingSubtotal = housing?.totalPrice ?? 0
    const housingDiscountable =
      !housing || !isNonDiscountableProduct(housing.product)
    const merchSubtotal = merch.reduce((sum, m) => sum + m.totalPrice, 0)
    const nonDiscountableMerchSubtotal = merch
      .filter((m) => isNonDiscountableProduct(m.product))
      .reduce((sum, m) => sum + m.totalPrice, 0)
    const discountableMerchSubtotal =
      merchSubtotal - nonDiscountableMerchSubtotal
    const patronSubtotal = patron?.amount ?? 0
    // One meal-plan entry = one weekly product purchase. Price already on the
    // resolved product reference; sum across all (attendee × week) entries.
    const mealPlansSubtotal = mealPlans.reduce(
      (sum, m) => sum + (m.product?.price ?? 0),
      0,
    )
    const nonDiscountableMealPlansSubtotal = mealPlans
      .filter((m) => m.product && isNonDiscountableProduct(m.product))
      .reduce((sum, m) => sum + (m.product?.price ?? 0), 0)
    const discountableMealPlansSubtotal =
      mealPlansSubtotal - nonDiscountableMealPlansSubtotal

    // Items from templated checkout steps. Split the same way.
    const allDynamicItems = Object.values(dynamicItems).flat()
    const dynamicSubtotal = allDynamicItems.reduce(
      (sum, item) => sum + item.price,
      0,
    )
    const nonDiscountableDynamicSubtotal = allDynamicItems
      .filter((item) => isNonDiscountableProduct(item.product))
      .reduce((sum, item) => sum + item.price, 0)
    const discountableDynamicSubtotal =
      dynamicSubtotal - nonDiscountableDynamicSubtotal

    const insuranceSubtotal = insuranceAmount
    const contributionSubtotal = contributionAmount

    // Discount base mirrors backend `standard_amount`: discountable passes +
    // housing (when not flagged) + discountable merch + discountable meals +
    // discountable dynamic items. Patron donations, patreon-category items,
    // and any product with `discountable: false` are charged in full.
    const discountableSubtotal =
      discountablePassesSubtotal +
      (housingDiscountable ? housingSubtotal : 0) +
      discountableMerchSubtotal +
      discountableMealPlansSubtotal +
      discountableDynamicSubtotal
    const promoDiscount = (discountableSubtotal * discountValue) / 100

    const nonDiscountableTotal =
      nonDiscountablePassesSubtotal +
      (housingDiscountable ? 0 : housingSubtotal) +
      nonDiscountableMerchSubtotal +
      nonDiscountableMealPlansSubtotal +
      nonDiscountableDynamicSubtotal +
      patronSubtotal

    const originalSubtotal =
      discountableSubtotal +
      nonDiscountableTotal +
      insuranceSubtotal +
      contributionSubtotal
    const discountedSubtotal = originalSubtotal - promoDiscount
    const accountCredit = appCredit ? Number(appCredit) : 0
    const credit = isEditing
      ? editCredit + accountCredit
      : accountCredit + monthUpgradeCredit
    const grandTotal = Math.max(0, discountedSubtotal - credit)
    // Effective credit consumed: what actually reduced the total. Caps at the
    // discounted subtotal so an over-large balance doesn't display more than
    // it removed (the surplus carries over as balance).
    const creditApplied = discountedSubtotal - grandTotal

    const itemCount =
      selectedPasses.length +
      (housing ? 1 : 0) +
      merch.length +
      (patron ? 1 : 0) +
      mealPlans.length +
      allDynamicItems.length

    return {
      passesSubtotal,
      housingSubtotal,
      merchSubtotal,
      patronSubtotal,
      mealPlansSubtotal,
      insuranceSubtotal,
      contributionSubtotal,
      discountableSubtotal,
      dynamicSubtotal,
      subtotal: originalSubtotal,
      discount: promoDiscount,
      credit,
      creditApplied,
      grandTotal,
      itemCount,
    }
  }, [
    selectedPasses,
    housing,
    merch,
    patron,
    mealPlans,
    dynamicItems,
    insuranceAmount,
    contributionAmount,
    isEditing,
    editCredit,
    monthUpgradeCredit,
    appCredit,
    discountValue,
  ])

  return { summary }
}
