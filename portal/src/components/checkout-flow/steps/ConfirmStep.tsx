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
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import InsuranceCard from "../InsuranceCard"

export default function ConfirmStep() {
  const { t } = useTranslation()
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
    buyerValues,
    buyerGeneralError,
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
    if (attendee?.name) return attendee.name
    const firstName = String(buyerValues.first_name ?? "").trim()
    const lastName = String(buyerValues.last_name ?? "").trim()
    const buyerFullName = `${firstName} ${lastName}`.trim()
    if (buyerFullName) return buyerFullName
    return "Unknown"
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
    Object.values(cart.dynamicItems).some((items) => items.length > 0) ||
    hasEditChanges

  // Insurance available if popup has insurance enabled with a valid percentage
  const isInsuranceEnabled =
    popup?.insurance_enabled === true && popup?.insurance_percentage != null
  const hasInsurableProducts =
    isInsuranceEnabled &&
    cart.insurancePotentialPrice > 0 &&
    summary.grandTotal - summary.insuranceSubtotal > 0

  // Extract template_config from the confirm step's nested 'insurance' sub-config
  const confirmStep = stepConfigs.find((s) => s.step_type === "confirm")
  const insuranceTemplateConfig =
    confirmStep?.template_config &&
    typeof confirmStep.template_config === "object" &&
    "insurance" in (confirmStep.template_config as object)
      ? ((confirmStep.template_config as Record<string, unknown>).insurance as {
          card_title?: string
          card_subtitle?: string
          toggle_label?: string
          benefits?: string[]
        })
      : null

  if (!hasCartItems) {
    // Header copy ("Nothing to review yet" / "Head back and pick some passes…")
    // already tells the user what to do — keep the body to a quiet icon so the
    // message isn't doubled up.
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShoppingBag
          className="w-12 h-12 text-checkout-subtitle"
          aria-hidden="true"
        />
        <span className="sr-only">{t("checkout.cart.empty_title")}</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {buyerGeneralError ? (
        <div className="bg-destructive/10 border border-destructive rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-destructive">Error</h4>
            <p className="text-sm text-destructive">{buyerGeneralError}</p>
          </div>
        </div>
      ) : null}

      {checkoutError && (
        <div className="bg-white border border-destructive rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-destructive">Error</h4>
            <p className="text-sm text-destructive">{checkoutError}</p>
          </div>
        </div>
      )}

      {hasInsurableProducts && (
        <InsuranceCard
          insurance={cart.insurance}
          price={cart.insurancePotentialPrice}
          onToggle={toggleInsurance}
          title={insuranceTemplateConfig?.card_title}
          subtitle={insuranceTemplateConfig?.card_subtitle}
          toggleLabel={insuranceTemplateConfig?.toggle_label}
          benefits={insuranceTemplateConfig?.benefits}
        />
      )}

      <div className="bg-checkout-card-bg rounded-2xl shadow-sm border border-border overflow-hidden">
        {/* Passes Section */}
        {cart.passes.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Ticket className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Passes
              </span>
            </div>
            <div className="space-y-3">
              {Object.entries(passesByAttendee).map(([attendeeId, passes]) => (
                <div key={attendeeId}>
                  <p className="text-sm font-medium text-foreground mb-1">
                    {getAttendeeName(attendeeId)}
                  </p>
                  {passes.map((pass) => (
                    <div
                      key={pass.productId}
                      className="flex items-center justify-between text-sm py-0.5"
                    >
                      <span className="text-muted-foreground">
                        {pass.quantity > 1 && (
                          <span className="text-muted-foreground">
                            {pass.quantity} ×{" "}
                          </span>
                        )}
                        {pass.product.name}
                      </span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(pass.originalPrice ?? pass.price)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dynamic Items Sections (tickets/passes added via templated steps) */}
        {Object.entries(cart.dynamicItems).map(
          ([stepType, items], groupIdx) => {
            if (items.length === 0) return null
            const stepConfig = stepConfigs.find((s) => s.step_type === stepType)
            const label = stepConfig?.title ?? stepType
            const isFirstSection = cart.passes.length === 0 && groupIdx === 0
            return (
              <div key={stepType}>
                {!isFirstSection && <div className="border-t border-border" />}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Ticket className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {label}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {items.map((item) => (
                      <div
                        key={item.productId}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          {item.quantity > 1 && (
                            <span className="text-muted-foreground">
                              {item.quantity} ×{" "}
                            </span>
                          )}
                          {item.product.name}
                        </span>
                        <span className="font-medium text-foreground">
                          {formatCurrency(item.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          },
        )}

        {/* Housing Section */}
        {cart.housing && (
          <>
            <div className="border-t border-border" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Home className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Housing
                </span>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {cart.housing.quantity > 1 && (
                      <span className="text-muted-foreground">
                        {cart.housing.quantity} ×{" "}
                      </span>
                    )}
                    {cart.housing.product.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {cart.housing.pricePerDay !== false
                      ? `${cart.housing.nights} night${cart.housing.nights !== 1 ? "s" : ""}`
                      : "Full stay"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCheckoutDate(cart.housing.checkIn)} –{" "}
                    {formatCheckoutDate(cart.housing.checkOut)}
                  </p>
                </div>
                <span className="font-medium text-foreground text-sm">
                  {formatCurrency(cart.housing.totalPrice)}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Merch Section */}
        {cart.merch.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Merchandise
                </span>
              </div>
              <div className="space-y-1">
                {cart.merch.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {item.quantity > 1 && (
                        <span className="text-muted-foreground">
                          {item.quantity} ×{" "}
                        </span>
                      )}
                      {item.product.name}
                    </span>
                    <span className="font-medium text-foreground">
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
            <div className="border-t border-border" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Patron
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Community contribution
                </span>
                <span className="font-medium text-foreground">
                  {formatCurrency(cart.patron.amount)}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Insurance in summary */}
        {cart.insurance && summary.insuranceSubtotal > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <CloudRain className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Insurance
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Change of plans coverage
                </span>
                <span className="font-medium text-foreground">
                  {formatCurrency(summary.insuranceSubtotal)}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Promo Code Section */}
        <div className="border-t border-border" />
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
                "flex-1 px-3 py-2 border rounded-lg text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent",
                promoError
                  ? "border-destructive bg-destructive/10"
                  : cart.promoCodeValid
                    ? "border-green-300 bg-green-50"
                    : "border-border",
              )}
            />
            {cart.promoCodeValid ? (
              <button
                type="button"
                onClick={handleClearPromo}
                aria-label="Remove promo code"
                className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors duration-200 shrink-0"
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
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-foreground text-background hover:bg-foreground/90",
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
            <div className="flex items-center gap-1.5 text-destructive text-xs mt-2">
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
            <div className="border-t border-border" />
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
                  className="mt-0.5 h-4 w-4 rounded border-border text-foreground focus:ring-2 focus:ring-foreground shrink-0"
                />
                <span className="text-sm text-muted-foreground">
                  I agree to the{" "}
                  <a
                    href={popup.terms_and_conditions_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80"
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
            "border-t border-border px-5 py-4",
            summary.grandTotal === 0
              ? "bg-gradient-to-r from-amber-50 to-orange-50"
              : "bg-muted",
          )}
        >
          {summary.discount > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground mb-2">
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
            <div className="flex justify-between text-sm text-primary mb-2">
              <span>Account Credit</span>
              <span>-{formatCurrency(accountCredit)}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="font-semibold text-foreground">
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
              <span className="text-2xl font-bold text-foreground">
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
