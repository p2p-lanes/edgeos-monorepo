"use client"

import { Heart, Home, Shield, ShoppingBag, Tag, Ticket, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCurrency } from "@/types/checkout"

export default function CartItemList() {
  const { t } = useTranslation()
  const {
    cart,
    summary,
    attendees,
    togglePass,
    resetDayProduct,
    clearHousing,
    updateMerchQuantity,
    clearPatron,
    clearPromoCode,
    removeDynamicItem,
    isEditing,
  } = useCheckout()

  const hasDynamicItems = Object.values(cart.dynamicItems).some(
    (items) => items.length > 0,
  )
  const hasEditChanges =
    isEditing && attendees.some((a) => a.products.some((p) => p.edit))
  const hasItems =
    summary.itemCount > 0 || hasDynamicItems || (isEditing && hasEditChanges)

  const getAttendeeName = (attendeeId: string): string => {
    const attendee = attendees.find((a) => a.id === attendeeId)
    return attendee?.name || "Unknown"
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
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Passes
          </h4>
          <div className="space-y-2">
            {cart.passes.map((pass) => (
              <div
                key={`${pass.attendeeId}-${pass.productId}`}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Ticket className="w-4 h-4 text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-checkout-title truncate">
                      {getAttendeeName(pass.attendeeId)}
                    </p>
                    <p className="text-xs text-checkout-subtitle">
                      {pass.quantity > 1 && <span>{pass.quantity} × </span>}
                      {pass.product.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-checkout-title">
                    {formatCurrency(pass.originalPrice ?? pass.price)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleRemovePass(pass.attendeeId, pass.productId)
                    }
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
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
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Housing
          </h4>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Home className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-checkout-title truncate">
                  {cart.housing.quantity > 1 && (
                    <span className="text-gray-500">
                      {cart.housing.quantity} ×{" "}
                    </span>
                  )}
                  {cart.housing.product.name}
                </p>
                <p className="text-xs text-checkout-subtitle">
                  {cart.housing.pricePerDay !== false
                    ? `${cart.housing.nights} night${cart.housing.nights !== 1 ? "s" : ""}`
                    : "Full stay"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-checkout-title">
                {formatCurrency(cart.housing.totalPrice)}
              </span>
              <button
                type="button"
                onClick={clearHousing}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
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
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Merchandise
          </h4>
          <div className="space-y-2">
            {cart.merch.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <ShoppingBag className="w-4 h-4 text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-checkout-title truncate">
                      {item.quantity > 1 && (
                        <span className="text-gray-500">
                          {item.quantity} ×{" "}
                        </span>
                      )}
                      {item.product.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-checkout-title">
                    {formatCurrency(item.totalPrice)}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateMerchQuantity(item.productId, 0)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
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
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Patron Contribution
          </h4>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Heart className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-checkout-title">
                Community Support
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-checkout-title">
                {formatCurrency(cart.patron.amount)}
              </span>
              <button
                type="button"
                onClick={clearPatron}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Items */}
      {hasDynamicItems && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Tickets
          </h4>
          <div className="space-y-2">
            {Object.values(cart.dynamicItems)
              .flat()
              .map((item) => (
                <div
                  key={item.productId}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Ticket className="w-4 h-4 text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-checkout-title truncate">
                        {item.quantity > 1 && (
                          <span className="text-gray-500">
                            {item.quantity} ×{" "}
                          </span>
                        )}
                        {item.product.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-checkout-title">
                      {formatCurrency(item.price)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        removeDynamicItem(item.stepType, item.productId)
                      }
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Insurance */}
      {cart.insurance && summary.insuranceSubtotal > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Pass Protection
          </h4>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-checkout-title">
                Coverage for all passes
              </span>
            </div>
            <span className="text-sm font-medium text-checkout-title">
              {formatCurrency(summary.insuranceSubtotal)}
            </span>
          </div>
        </div>
      )}

      {/* Promo Code */}
      {cart.promoCodeValid && cart.promoCode && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Promo Code
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
                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {!hasItems && (
        <div className="py-8 text-center">
          <p className="text-gray-500">{t("checkout.cart.empty_title")}</p>
        </div>
      )}
    </>
  )
}
