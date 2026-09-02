"use client"

import {
  BedDouble,
  HandCoins,
  Heart,
  Home,
  Shield,
  ShoppingBag,
  Tag,
  Ticket,
  Utensils,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { resolveStepIcon } from "@/lib/checkoutStepIcons"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"

export default function CartItemList({
  showServiceFee = true,
}: {
  /** The service fee only makes sense once the buyer reaches the confirm
   *  step; earlier steps show products only. Defaults to shown. */
  showServiceFee?: boolean
} = {}) {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const popup = getCity()
  const {
    cart,
    summary,
    attendees,
    togglePass,
    resetDayProduct,
    clearHousing,
    removeAccommodation,
    updateMerchQuantity,
    clearPatron,
    removeMealPlan,
    clearPromoCode,
    removeDynamicItem,
    isEditing,
    stepConfigs,
  } = useCheckout()

  // Group dynamic items by their originating step so the drawer renders one
  // section per step type ("Housing", "Parking", …) with the matching icon,
  // instead of dumping every dynamic item under a single "Tickets" heading.
  const dynamicGroups = Object.entries(cart.dynamicItems)
    .filter(([, items]) => items.length > 0)
    .map(([stepType, items]) => {
      const stepConfig = stepConfigs.find((s) => s.step_type === stepType)
      const Icon = resolveStepIcon({
        stepType,
        template: stepConfig?.template,
        emoji: stepConfig?.emoji,
      })
      return {
        stepType,
        label: stepConfig?.title ?? stepType,
        Icon,
        items,
      }
    })

  const hasDynamicItems = dynamicGroups.length > 0
  const hasEditChanges =
    isEditing && attendees.some((a) => a.products.some((p) => p.edit))
  const hasItems =
    summary.itemCount > 0 || hasDynamicItems || (isEditing && hasEditChanges)

  const getAttendeeName = (attendeeId: string): string => {
    const attendee = attendees.find((a) => a.id === attendeeId)
    return attendee?.name || t("checkout.cart.unknown_attendee")
  }

  const handleRemovePass = (attendeeId: string, productId: string) => {
    const pass = cart.passes.find(
      (p) => p.attendeeId === attendeeId && p.productId === productId,
    )
    if (!pass) return
    if (pass.product.duration_type === "day") {
      resetDayProduct(attendeeId, productId)
    } else {
      togglePass(attendeeId, productId, 0)
    }
  }

  return (
    <>
      {/* Passes */}
      {cart.passes.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.cart.passes")}
          </h4>
          <div className="space-y-2">
            {cart.passes.map((pass) => (
              <div
                key={`${pass.attendeeId}-${pass.productId}`}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Ticket className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {getAttendeeName(pass.attendeeId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {pass.quantity > 1 && <span>{pass.quantity} × </span>}
                      {pass.product.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {formatCurrency(pass.originalPrice ?? pass.price)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleRemovePass(pass.attendeeId, pass.productId)
                    }
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Booked rooms */}
      {cart.accommodations.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.accommodation.cart_title")}
          </h4>
          <div className="space-y-1">
            {cart.accommodations.map((item) => (
              <div
                key={`${item.accommodationId}-${item.checkIn}-${item.checkOut}`}
                className="flex items-center justify-between py-2"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <BedDouble className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.propertyName ? `${item.propertyName} · ` : ""}
                      {formatCheckoutDate(item.checkIn)} →{" "}
                      {formatCheckoutDate(item.checkOut)} ·{" "}
                      {t("checkout.accommodation.guests", {
                        count: item.guestCount,
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {formatCurrency(item.totalPrice)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      removeAccommodation(
                        item.accommodationId,
                        item.checkIn,
                        item.checkOut,
                      )
                    }
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Housing */}
      {cart.housing && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.cart.housing")}
          </h4>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Home className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {cart.housing.quantity > 1 && (
                    <span className="text-muted-foreground">
                      {cart.housing.quantity} ×{" "}
                    </span>
                  )}
                  {cart.housing.product.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cart.housing.pricePerDay !== false
                    ? t("checkout.accommodation.nights", {
                        count: cart.housing.nights,
                      })
                    : t("checkout.cart.full_stay")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {formatCurrency(cart.housing.totalPrice)}
              </span>
              <button
                type="button"
                onClick={clearHousing}
                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merch */}
      {cart.merch.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.cart.merchandise")}
          </h4>
          <div className="space-y-2">
            {cart.merch.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <ShoppingBag className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.quantity > 1 && (
                        <span className="text-muted-foreground">
                          {item.quantity} ×{" "}
                        </span>
                      )}
                      {item.product.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {formatCurrency(item.totalPrice)}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateMerchQuantity(item.productId, 0)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patron */}
      {cart.patron && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.cart.patron_contribution")}
          </h4>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Heart className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground">
                {t("checkout.cart.community_support")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {formatCurrency(cart.patron.amount)}
              </span>
              <button
                type="button"
                onClick={clearPatron}
                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Meal Plans — one row per (attendee × week). Total = sum of weekly
          product prices; click X to remove that week from the cart. */}
      {cart.mealPlans.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.cart.meal_plans")}
          </h4>
          <div className="space-y-2">
            {cart.mealPlans.map((mp) => (
              <div
                key={`${mp.attendeeId}-${mp.productId}`}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Utensils className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {getAttendeeName(mp.attendeeId)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {mp.product.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {formatCurrency(mp.product.price)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMealPlan(mp.attendeeId, mp.productId)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dynamic Items — one group per step (Housing, Parking, …) */}
      {dynamicGroups.map(({ stepType, label, Icon, items }) => (
        <div key={stepType} className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </h4>
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.quantity > 1 && (
                        <span className="text-muted-foreground">
                          {item.quantity} ×{" "}
                        </span>
                      )}
                      {item.product.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {formatCurrency(item.price * item.quantity)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      removeDynamicItem(item.stepType, item.productId)
                    }
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Insurance */}
      {cart.insurance && summary.insuranceSubtotal > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.cart.pass_protection")}
          </h4>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground">
                {t("checkout.cart.pass_protection_description")}
              </span>
            </div>
            <span className="text-sm font-medium text-foreground">
              {formatCurrency(summary.insuranceSubtotal)}
            </span>
          </div>
        </div>
      )}

      {/* Contribution fee — mandatory when popup has it enabled; no buyer
          toggle. Hidden until the confirm step so earlier steps show a
          products-only cart. */}
      {showServiceFee && summary.contributionSubtotal > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 min-w-0">
              <HandCoins className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground">
                {popup?.contribution_label ||
                  t("checkout.contribution.fallbackLabel")}
                {popup?.contribution_percentage
                  ? ` (${Number(popup.contribution_percentage)}%)`
                  : ""}
              </span>
            </div>
            <span className="text-sm font-medium text-foreground">
              {formatCurrency(summary.contributionSubtotal)}
            </span>
          </div>
          {popup?.contribution_description && (
            <p className="text-xs text-muted-foreground mt-1 ml-7">
              {popup.contribution_description}
            </p>
          )}
        </div>
      )}

      {/* Promo Code */}
      {cart.promoCodeValid && cart.promoCode && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("checkout.cart.promo_code")}
          </h4>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Tag className="w-4 h-4 text-green-500 shrink-0" />
              <span className="text-sm font-medium text-green-700">
                {cart.promoCode}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-green-600">
                -{cart.promoCodeDiscount}%
              </span>
              <button
                type="button"
                onClick={clearPromoCode}
                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credit applied — explains why the total is lower than the item
          prices. summary.credit already blends account balance and edit
          give-up credit; show it whenever any credit reduces the total. */}
      {summary.creditApplied > 0 && (
        <div className="flex items-center justify-between py-2 border-t border-border/50">
          <span className="text-sm font-medium text-green-700">
            {t("checkout.credit_applied_label")}
          </span>
          <span className="text-sm font-medium text-green-600">
            -{formatCurrency(summary.creditApplied)}
          </span>
        </div>
      )}

      {!hasItems && (
        <div className="py-8 text-center">
          <p className="text-muted-foreground">
            {t("checkout.cart.empty_title")}
          </p>
        </div>
      )}
    </>
  )
}
