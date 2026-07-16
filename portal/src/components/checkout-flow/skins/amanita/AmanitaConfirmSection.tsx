"use client"

/**
 * Amanita skin — Confirm section (order summary + coupon + total).
 *
 * Ported from checkout-amanita/codigo/checkout/sections.tsx (`ConfirmSection`)
 * — cream card order summary, coupon input, Subtotal/Coupon/Total breakdown,
 * and the "Todavía no elegiste tus pases" empty state with a "Ver tickets"
 * `.btn-ornate-2` CTA. Unlike the mockup (local `lines`/`subtotal`/`discount`/
 * `total`/`couponApplied` props over a mock cart), this component is fed by
 * the REAL checkout data via `useCheckout()` — the exact same cart-slice
 * fields ConfirmStep.tsx renders (passes / dynamicItems / housing / merch /
 * patron / mealPlans / contribution) — and the real `applyPromoCode` /
 * `clearPromoCode` mutations, mirroring ConfirmStep's
 * `handleApplyPromo`/`handleClearPromo` local-state pattern.
 *
 * Scope note: unlike ConfirmStep, this component does NOT render the
 * interactive `InsuranceCard` toggle (out of this task's explicit
 * requirements — order summary / coupon / total / terms / empty state). If
 * insurance is already toggled on elsewhere, its charge still shows as a
 * summary line so the total stays correct.
 *
 * Payment triggers: the mockup's in-card "Confirmar compra" button was
 * originally omitted here, leaving the stepper's fixed bottom bar as the sole
 * trigger. It is now rendered alongside the bar's, matching the mockup, so the
 * same payment has two buttons. They are deliberately NOT independent: `onPay`
 * and `payDisabled` are the bar's own handler and gate, passed down. Deriving
 * a second `canPay` here from `useCheckout()` would let the two disagree — the
 * card could still look armed while the bar is mid-submit, which is exactly
 * how a double charge gets in.
 */
import {
  AlertCircle,
  CloudRain,
  HandCoins,
  Heart,
  Home,
  Loader2,
  ShoppingBag,
  Ticket,
  Utensils,
  X,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import { CornerFrame } from "./Ornaments"
import { SectionShell } from "./SectionShell"

const CREAM_CARD_STYLE = {
  border: "1px solid rgba(193,170,136,0.4)",
  boxShadow: "0 18px 48px rgba(1,15,22,0.5)",
} as const

const ROW_BORDER = "rgba(4,34,49,0.12)"
const MUTED = "#4a6670"
const ERROR = "#b3271e"

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof Ticket
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4" style={{ color: MUTED }} />
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: MUTED }}
      >
        {children}
      </span>
    </div>
  )
}

export default function AmanitaConfirmSection({
  onGoToTickets,
  onPay,
  payDisabled,
}: {
  onGoToTickets?: () => void
  /** The stepper's own payment handler — see the header note on why this is
   *  passed in rather than pulled from `useCheckout()` here. */
  onPay?: () => void
  payDisabled?: boolean
}) {
  const { t } = useTranslation()
  const {
    cart,
    summary,
    attendees,
    applyPromoCode,
    clearPromoCode,
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
    removeMealPlan,
    housingDatesShown,
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
      setPromoError(t("checkout.amanita.confirm_coupon_missing"))
      return
    }
    setPromoLoading(true)
    setPromoError("")
    try {
      const success = await applyPromoCode(promoInput.trim().toUpperCase())
      if (!success) {
        setPromoError(t("checkout.amanita.confirm_coupon_invalid"))
      }
    } catch {
      setPromoError(t("checkout.amanita.confirm_coupon_error"))
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
      if (!acc[pass.attendeeId]) acc[pass.attendeeId] = []
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
    cart.mealPlans.length > 0 ||
    Object.values(cart.dynamicItems).some((items) => items.length > 0) ||
    hasEditChanges

  const hasDiscountableItems = summary.discountableSubtotal > 0

  const isNonDiscountable = (product?: { discountable?: boolean | null }) =>
    product?.discountable === false

  const nonDiscountableTotal =
    summary.subtotal -
    summary.discountableSubtotal -
    summary.insuranceSubtotal -
    summary.contributionSubtotal
  const showEligibleQualifier = summary.discount > 0 && nonDiscountableTotal > 0
  const notEligibleCaption = t("checkout.discount.not_eligible_caption")

  if (!hasCartItems) {
    return (
      <SectionShell
        gem="bold"
        kicker={t("checkout.amanita.confirm_kicker")}
        title={t("checkout.amanita.confirm_title")}
      >
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <ShoppingBag className="w-12 h-12 text-cream/60" aria-hidden="true" />
          <p className="font-display text-xl uppercase tracking-wide text-cream">
            {t("checkout.amanita.confirm_empty_title")}
          </p>
          <p
            className="max-w-[38ch] text-sm"
            style={{ color: "rgba(241,235,227,0.72)" }}
          >
            {t("checkout.amanita.confirm_empty_body")}
          </p>
          <button
            type="button"
            onClick={onGoToTickets}
            className="btn-ornate-2 mt-2 inline-flex items-center justify-center !px-8 py-3 font-condensed text-sm font-medium uppercase tracking-[0.12em]"
          >
            {t("checkout.amanita.confirm_go_tickets")}
          </button>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell
      gem="bold"
      kicker={t("checkout.amanita.confirm_kicker")}
      title={t("checkout.amanita.confirm_title")}
      intro={t("checkout.amanita.confirm_intro")}
    >
      {buyerGeneralError ? (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{
            backgroundColor: "rgba(179,39,30,0.12)",
            border: `1px solid ${ERROR}`,
          }}
        >
          <AlertCircle
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: ERROR }}
          />
          <p className="text-sm" style={{ color: ERROR }}>
            {buyerGeneralError}
          </p>
        </div>
      ) : null}

      {checkoutError && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{
            backgroundColor: "rgba(179,39,30,0.12)",
            border: `1px solid ${ERROR}`,
          }}
        >
          <AlertCircle
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: ERROR }}
          />
          <p className="text-sm" style={{ color: ERROR }}>
            {checkoutError}
          </p>
        </div>
      )}

      <CornerFrame>
        <div
          className="rounded-2xl bg-cream text-left overflow-hidden"
          style={CREAM_CARD_STYLE}
        >
          <h3 className="font-display text-xl uppercase tracking-wide text-deep px-5 pt-5 md:px-8 md:pt-8">
            {t("checkout.amanita.confirm_order_title")}
          </h3>

          {/* Passes */}
          {cart.passes.length > 0 && (
            <div className="px-5 py-4 md:px-8">
              <SectionLabel icon={Ticket}>
                {t("checkout.step_short.passes")}
              </SectionLabel>
              <div className="space-y-3">
                {Object.entries(passesByAttendee).map(
                  ([attendeeId, passes]) => (
                    <div key={attendeeId}>
                      <p className="text-sm font-medium text-deep mb-1">
                        {getAttendeeName(attendeeId)}
                      </p>
                      {passes.map((pass) => (
                        <div
                          key={pass.productId}
                          className="flex items-start justify-between text-sm py-0.5"
                        >
                          <div className="flex flex-col">
                            <span style={{ color: MUTED }}>
                              {pass.quantity > 1 && <>{pass.quantity} × </>}
                              {pass.product.name}
                            </span>
                            {isNonDiscountable(pass.product) && (
                              <span
                                className="text-xs"
                                style={{ color: MUTED, opacity: 0.7 }}
                              >
                                {notEligibleCaption}
                              </span>
                            )}
                          </div>
                          <span className="font-medium text-deep shrink-0">
                            {formatCurrency(pass.originalPrice ?? pass.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Dynamic items (templated steps) */}
          {Object.entries(cart.dynamicItems).map(([stepType, items]) => {
            if (items.length === 0) return null
            const stepConfig = stepConfigs.find((s) => s.step_type === stepType)
            const label = stepConfig?.title ?? stepType
            return (
              <div key={stepType}>
                <div className="border-t" style={{ borderColor: ROW_BORDER }} />
                <div className="px-5 py-4 md:px-8">
                  <SectionLabel icon={Ticket}>{label}</SectionLabel>
                  <div className="space-y-1">
                    {items.map((item) => (
                      <div
                        key={item.productId}
                        className="flex items-start justify-between text-sm"
                      >
                        <div className="flex flex-col">
                          <span style={{ color: MUTED }}>
                            {item.quantity > 1 && <>{item.quantity} × </>}
                            {item.product.name}
                          </span>
                          {isNonDiscountable(item.product) && (
                            <span
                              className="text-xs"
                              style={{ color: MUTED, opacity: 0.7 }}
                            >
                              {notEligibleCaption}
                            </span>
                          )}
                        </div>
                        <span className="font-medium text-deep shrink-0">
                          {formatCurrency(item.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Housing */}
          {cart.housing && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <SectionLabel icon={Home}>
                  {t("checkout.step_short.housing")}
                </SectionLabel>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-deep">
                      {cart.housing.quantity > 1 && (
                        <>{cart.housing.quantity} × </>
                      )}
                      {cart.housing.product.name}
                    </p>
                    <p className="text-xs" style={{ color: MUTED }}>
                      {cart.housing.pricePerDay !== false
                        ? `${cart.housing.nights} night${cart.housing.nights !== 1 ? "s" : ""}`
                        : "Full stay"}
                    </p>
                    {housingDatesShown && (
                      <p className="text-xs" style={{ color: MUTED }}>
                        {formatCheckoutDate(cart.housing.checkIn)} –{" "}
                        {formatCheckoutDate(cart.housing.checkOut)}
                      </p>
                    )}
                    {isNonDiscountable(cart.housing.product) && (
                      <p
                        className="text-xs"
                        style={{ color: MUTED, opacity: 0.7 }}
                      >
                        {notEligibleCaption}
                      </p>
                    )}
                  </div>
                  <span className="font-medium text-deep text-sm shrink-0">
                    {formatCurrency(cart.housing.totalPrice)}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Merch */}
          {cart.merch.length > 0 && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <SectionLabel icon={ShoppingBag}>
                  {t("checkout.step_short.merch")}
                </SectionLabel>
                <div className="space-y-1">
                  {cart.merch.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-start justify-between text-sm"
                    >
                      <div className="flex flex-col">
                        <span style={{ color: MUTED }}>
                          {item.quantity > 1 && <>{item.quantity} × </>}
                          {item.product.name}
                        </span>
                        {isNonDiscountable(item.product) && (
                          <span
                            className="text-xs"
                            style={{ color: MUTED, opacity: 0.7 }}
                          >
                            {notEligibleCaption}
                          </span>
                        )}
                      </div>
                      <span className="font-medium text-deep shrink-0">
                        {formatCurrency(item.totalPrice)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Patron */}
          {cart.patron && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <SectionLabel icon={Heart}>
                  {t("checkout.step_short.patron")}
                </SectionLabel>
                <div className="flex items-start justify-between text-sm">
                  <div className="flex flex-col">
                    <span style={{ color: MUTED }}>
                      {t("checkout.amanita.confirm_patron_label")}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: MUTED, opacity: 0.7 }}
                    >
                      {notEligibleCaption}
                    </span>
                  </div>
                  <span className="font-medium text-deep shrink-0">
                    {formatCurrency(cart.patron.amount)}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Meal plans */}
          {cart.mealPlans.length > 0 && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <SectionLabel icon={Utensils}>
                  {t("checkout.amanita.confirm_meal_plans_label")}
                </SectionLabel>
                <div className="space-y-1">
                  {cart.mealPlans.map((mp) => (
                    <div
                      key={`${mp.attendeeId}-${mp.productId}`}
                      className="flex items-center justify-between text-sm py-0.5"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-sm font-medium text-deep truncate">
                          {getAttendeeName(mp.attendeeId)}
                        </p>
                        <p
                          className="text-xs truncate"
                          style={{ color: MUTED }}
                        >
                          {mp.product.name}
                        </p>
                        {isNonDiscountable(mp.product) && (
                          <p
                            className="text-xs"
                            style={{ color: MUTED, opacity: 0.7 }}
                          >
                            {notEligibleCaption}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-medium text-deep">
                          {formatCurrency(mp.product.price)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            removeMealPlan(mp.attendeeId, mp.productId)
                          }
                          aria-label={`Remove ${mp.product.name}`}
                          className="p-1 transition-colors"
                          style={{ color: MUTED }}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Insurance (summary line only — no toggle in this skin) */}
          {cart.insurance && summary.insuranceSubtotal > 0 && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <SectionLabel icon={CloudRain}>
                  {t("checkout.amanita.confirm_insurance_label")}
                </SectionLabel>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: MUTED }}>
                    {t("checkout.amanita.confirm_insurance_subtitle")}
                  </span>
                  <span className="font-medium text-deep">
                    {formatCurrency(summary.insuranceSubtotal)}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Contribution fee */}
          {summary.contributionSubtotal > 0 && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <HandCoins
                      className="w-4 h-4 shrink-0"
                      style={{ color: MUTED }}
                    />
                    <span className="text-deep">
                      {popup?.contribution_label ||
                        t("checkout.contribution.fallbackLabel")}
                      {popup?.contribution_percentage
                        ? ` (${Number(popup.contribution_percentage)}%)`
                        : ""}
                    </span>
                  </div>
                  <span className="font-medium text-deep shrink-0">
                    {formatCurrency(summary.contributionSubtotal)}
                  </span>
                </div>
                {popup?.contribution_description && (
                  <p className="text-xs mt-2 ml-6" style={{ color: MUTED }}>
                    {popup.contribution_description}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Coupon */}
          {popup?.allows_coupons && hasDiscountableItems && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <label
                  htmlFor="ck-cupon"
                  className="font-condensed text-xs font-medium uppercase tracking-[0.16em] text-primary"
                >
                  {t("checkout.amanita.confirm_coupon_label")}
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="ck-cupon"
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
                    placeholder={t(
                      "checkout.amanita.confirm_coupon_placeholder",
                    )}
                    disabled={cart.promoCodeValid}
                    className="w-full min-w-0 rounded-xl border px-4 py-2.5 text-sm uppercase text-deep outline-none transition-shadow focus:ring-2 focus:ring-accent disabled:opacity-60"
                    style={{
                      backgroundColor: "#faf6ef",
                      borderColor: promoError ? ERROR : "rgba(4,34,49,0.18)",
                    }}
                  />
                  {cart.promoCodeValid ? (
                    <button
                      type="button"
                      onClick={handleClearPromo}
                      aria-label={t("checkout.amanita.confirm_coupon_remove")}
                      className="shrink-0 rounded-full border px-4 py-2.5 font-condensed text-xs font-medium uppercase tracking-[0.12em] text-deep transition-colors"
                      style={{ borderColor: "rgba(4,34,49,0.18)" }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleApplyPromo}
                      disabled={promoLoading || isLoading || !promoInput.trim()}
                      className="shrink-0 rounded-full bg-primary px-5 py-2.5 font-condensed text-xs font-medium uppercase tracking-[0.12em] text-cream transition-colors hover:bg-deep disabled:opacity-60"
                    >
                      {promoLoading || isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        t("checkout.amanita.confirm_coupon_apply")
                      )}
                    </button>
                  )}
                </div>
                {promoError && (
                  <div
                    className="flex items-center gap-1.5 text-xs mt-2"
                    style={{ color: ERROR }}
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span>{promoError}</span>
                  </div>
                )}
                {cart.promoCodeValid && (
                  <p className="text-xs font-semibold mt-2 text-primary">
                    {t("checkout.amanita.confirm_coupon_applied")}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Terms and conditions */}
          {popup?.terms_and_conditions_url && (
            <>
              <div className="border-t" style={{ borderColor: ROW_BORDER }} />
              <div className="px-5 py-4 md:px-8">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded"
                  />
                  <span className="text-sm" style={{ color: MUTED }}>
                    {t("checkout.amanita.confirm_terms_prefix")}{" "}
                    <a
                      href={popup.terms_and_conditions_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t("checkout.amanita.confirm_terms_link")}
                    </a>
                  </span>
                </label>
              </div>
            </>
          )}

          {/* Totals */}
          <div
            className="border-t px-5 py-4 md:px-8"
            style={{ borderColor: ROW_BORDER }}
          >
            {summary.discount > 0 && (
              <div
                className="flex justify-between text-sm mb-2"
                style={{ color: MUTED }}
              >
                <span>{t("checkout.amanita.confirm_subtotal_label")}</span>
                <span>{formatCurrency(summary.subtotal)}</span>
              </div>
            )}
            {summary.discount > 0 && (
              <div className="flex justify-between text-sm mb-2 text-primary">
                <span>
                  {showEligibleQualifier
                    ? t("checkout.discount.promo_discount_eligible_label")
                    : t("checkout.amanita.confirm_discount_label")}
                </span>
                <span>-{formatCurrency(summary.discount)}</span>
              </div>
            )}
            {isEditing && editCredit > 0 && (
              <div className="flex justify-between text-sm mb-2 text-primary">
                <span>{t("checkout.amanita.confirm_edit_credit_label")}</span>
                <span>-{formatCurrency(editCredit)}</span>
              </div>
            )}
            {monthUpgradeCredit > 0 && (
              <div className="flex justify-between text-sm mb-2 text-primary">
                <span>{t("checkout.amanita.confirm_credit_label")}</span>
                <span>-{formatCurrency(monthUpgradeCredit)}</span>
              </div>
            )}
            {accountCredit > 0 && (
              <div className="flex justify-between text-sm mb-2 text-primary">
                <span>
                  {t("checkout.amanita.confirm_account_credit_label")}
                </span>
                <span>-{formatCurrency(accountCredit)}</span>
              </div>
            )}
            <div className="flex items-end justify-between">
              <p className="font-condensed text-sm font-medium uppercase tracking-[0.2em] text-primary">
                {summary.discount > 0 || summary.credit > 0
                  ? t("checkout.amanita.confirm_total_label")
                  : t("checkout.amanita.confirm_subtotal_label")}
              </p>
              <p className="font-condensed text-3xl leading-none text-deep">
                {formatCurrency(summary.grandTotal)}
              </p>
            </div>
            {summary.grandTotal === 0 && (
              <p className="mt-2 text-center text-sm text-primary">
                {t("checkout.amanita.confirm_free_note")}
              </p>
            )}
            {onPay && (
              <button
                type="button"
                onClick={onPay}
                disabled={payDisabled}
                className="btn-ornate-2 btn-gold-fill ck-gold mt-5 flex w-full items-center justify-center whitespace-nowrap py-3 font-condensed text-sm font-medium uppercase tracking-[0.12em] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {summary.grandTotal === 0
                  ? t("checkout.actions.claim_pass")
                  : t("checkout.amanita.confirm_cta")}
              </button>
            )}
          </div>
        </div>
      </CornerFrame>
    </SectionShell>
  )
}
