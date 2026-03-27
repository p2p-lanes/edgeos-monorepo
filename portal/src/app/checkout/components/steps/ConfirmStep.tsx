"use client"

import {
  AlertCircle,
  CloudRain,
  Heart,
  Home,
  Loader2,
  ShoppingBag,
  Sparkles,
  Ticket,
  X,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import InsuranceCard from "../InsuranceCard"

export default function ConfirmStep() {
  const {
    cart,
    summary,
    attendees,
    applyPromoCode,
    clearPromoCode,
    toggleInsurance,
    isLoading,
    error: checkoutError,
    isEditing,
    editCredit,
    monthUpgradeCredit,
    termsAccepted,
    setTermsAccepted,
    stepConfigs,
  } = useCheckout()
  const { getCity } = useCityProvider()
  const popup = getCity()
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()
  const accountCredit = application?.credit ? Number(application.credit) : 0

  const [promoInput, setPromoInput] = useState(cart.promoCode)
  const [promoError, setPromoError] = useState("")
  const [promoLoading, setPromoLoading] = useState(false)

  const handleApplyPromo = async () => {
    if (!promoInput.trim()) {
      setPromoError("Please enter a promo code")
      return
    }

    setPromoLoading(true)
    setPromoError("")

    try {
      const success = await applyPromoCode(promoInput.trim().toUpperCase())
      if (!success) {
        setPromoError("Invalid promo code")
      }
    } catch {
      setPromoError("Failed to validate promo code")
    } finally {
      setPromoLoading(false)
    }
  }

  const handleClearPromo = () => {
    setPromoInput("")
    setPromoError("")
    clearPromoCode()
  }

  const getAttendeeName = (attendeeId: string): string => {
    const attendee = attendees.find((a) => a.id === attendeeId)
    return attendee?.name || "Unknown"
  }

  const passesByAttendee = cart.passes.reduce(
    (acc, pass) => {
      if (!acc[pass.attendeeId]) {
        acc[pass.attendeeId] = []
      }
      acc[pass.attendeeId].push(pass)
      return acc
    },
    {} as Record<string, typeof cart.passes>,
  )

  const hasEditChanges =
    isEditing && attendees.some((a) => a.products.some((p) => p.edit))
  const hasCartItems =
    cart.passes.length > 0 ||
    cart.housing ||
    cart.merch.length > 0 ||
    cart.patron ||
    hasEditChanges

  // Insurance available if any product has insurance potential and total is not zero
  const isInsuranceEnabled = stepConfigs.some((s) => s.step_type === "insurance_checkout")
  const hasInsurableProducts =
    isInsuranceEnabled &&
    cart.insurancePotentialPrice > 0 &&
    summary.grandTotal - summary.insuranceSubtotal > 0

  if (!hasCartItems) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShoppingBag className="w-12 h-12 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Your cart is empty
        </h3>
        <p className="text-gray-500 max-w-md">
          Please go back and select some passes to continue.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {checkoutError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-red-800">Error</h4>
            <p className="text-sm text-red-600">{checkoutError}</p>
          </div>
        </div>
      )}

      {hasInsurableProducts && (
        <InsuranceCard
          insurance={cart.insurance}
          price={cart.insurancePotentialPrice}
          onToggle={toggleInsurance}
        />
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Passes Section */}
        {cart.passes.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Ticket className="w-4 h-4 text-gray-500" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Passes
              </span>
            </div>
            <div className="space-y-3">
              {Object.entries(passesByAttendee).map(([attendeeId, passes]) => (
                <div key={attendeeId}>
                  <p className="text-sm font-medium text-gray-700 mb-1">
                    {getAttendeeName(attendeeId)}
                  </p>
                  {passes.map((pass) => (
                    <div
                      key={pass.productId}
                      className="flex items-center justify-between text-sm py-0.5"
                    >
                      <span className="text-gray-600">{pass.product.name}</span>
                      <span className="font-medium text-gray-900">
                        {formatCurrency(pass.originalPrice ?? pass.price)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Housing Section */}
        {cart.housing && (
          <>
            <div className="border-t border-gray-100" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Home className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Housing
                </span>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    {cart.housing.product.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {cart.housing.nights} night
                    {cart.housing.nights !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatCheckoutDate(cart.housing.checkIn)} –{" "}
                    {formatCheckoutDate(cart.housing.checkOut)}
                  </p>
                </div>
                <span className="font-medium text-gray-900 text-sm">
                  {formatCurrency(cart.housing.totalPrice)}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Merch Section */}
        {cart.merch.length > 0 && (
          <>
            <div className="border-t border-gray-100" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <ShoppingBag className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Merchandise
                </span>
              </div>
              <div className="space-y-1">
                {cart.merch.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-600">
                      {item.product.name}{" "}
                      <span className="text-gray-400">×{item.quantity}</span>
                    </span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(item.totalPrice)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Patron Section */}
        {cart.patron && (
          <>
            <div className="border-t border-gray-100" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Patron
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Community contribution</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(cart.patron.amount)}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Insurance in summary */}
        {cart.insurance && summary.insuranceSubtotal > 0 && (
          <>
            <div className="border-t border-gray-100" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <CloudRain className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Insurance
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Change of plans coverage</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(summary.insuranceSubtotal)}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Promo Code Section */}
        <div className="border-t border-gray-100" />
        <div className="px-4 sm:px-5 py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <input
              type="text"
              value={promoInput}
              onChange={(e) => {
                setPromoInput(e.target.value.toUpperCase())
                setPromoError("")
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleApplyPromo()
                }
              }}
              placeholder="Promo code"
              disabled={cart.promoCodeValid}
              className={cn(
                "flex-1 px-3 py-2 border rounded-lg text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                promoError
                  ? "border-red-300 bg-red-50"
                  : cart.promoCodeValid
                    ? "border-green-300 bg-green-50"
                    : "border-gray-200",
              )}
            />
            {cart.promoCodeValid ? (
              <button
                type="button"
                onClick={handleClearPromo}
                aria-label="Remove promo code"
                className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 text-gray-500 hover:bg-red-100 hover:text-red-600 transition-colors duration-200 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApplyPromo}
                disabled={promoLoading || isLoading || !promoInput.trim()}
                className={cn(
                  "px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0",
                  !promoInput.trim()
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-gray-900 text-white hover:bg-gray-800",
                )}
              >
                {promoLoading || isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Apply"
                )}
              </button>
            )}
          </div>
          {promoError && (
            <div className="flex items-center gap-1.5 text-red-600 text-xs mt-2">
              <AlertCircle className="w-3 h-3" />
              <span>{promoError}</span>
            </div>
          )}
          {cart.promoCodeValid && (
            <p className="text-green-600 text-xs mt-2">Code applied!</p>
          )}
        </div>

        {/* Terms and Conditions */}
        {popup?.terms_and_conditions_url && (
          <>
            <div className="border-t border-gray-100" />
            <div className="px-5 py-4">
              <label
                htmlFor="terms-checkbox"
                className="flex items-start gap-3 cursor-pointer"
              >
                <input
                  id="terms-checkbox"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-900 shrink-0"
                />
                <span className="text-sm text-gray-600">
                  I agree to the{" "}
                  <a
                    href={popup.terms_and_conditions_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-800"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Terms and Conditions
                  </a>
                </span>
              </label>
            </div>
          </>
        )}

        {/* Subtotal */}
        <div
          className={cn(
            "border-t border-gray-200 px-5 py-4",
            summary.grandTotal === 0
              ? "bg-gradient-to-r from-amber-50 to-orange-50"
              : "bg-gray-50",
          )}
        >
          {summary.discount > 0 && (
            <div className="flex justify-between text-sm text-gray-500 mb-2">
              <span>Subtotal</span>
              <span>{formatCurrency(summary.subtotal)}</span>
            </div>
          )}
          {summary.discount > 0 && (
            <div className="flex justify-between text-sm text-green-600 mb-2">
              <span>Promo Discount</span>
              <span>-{formatCurrency(summary.discount)}</span>
            </div>
          )}
          {isEditing && editCredit > 0 && (
            <div className="flex justify-between text-sm text-orange-600 mb-2">
              <span>Edit Credit</span>
              <span>-{formatCurrency(editCredit)}</span>
            </div>
          )}
          {monthUpgradeCredit > 0 && (
            <div className="flex justify-between text-sm text-emerald-600 mb-2">
              <span>Credit</span>
              <span>-{formatCurrency(monthUpgradeCredit)}</span>
            </div>
          )}
          {accountCredit > 0 && (
            <div className="flex justify-between text-sm text-blue-600 mb-2">
              <span>Account Credit</span>
              <span>-{formatCurrency(accountCredit)}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="font-semibold text-gray-900">
              {summary.discount > 0 || summary.credit > 0
                ? "Total"
                : "Subtotal"}
            </span>
            {summary.grandTotal === 0 ? (
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <span className="text-2xl font-bold text-amber-600">$0</span>
              </div>
            ) : (
              <span className="text-2xl font-bold text-gray-900">
                {formatCurrency(summary.grandTotal)}
              </span>
            )}
          </div>
          {summary.grandTotal === 0 && (
            <p className="text-sm text-amber-600 mt-2 text-center">
              You don&apos;t need to pay, your order is covered
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
