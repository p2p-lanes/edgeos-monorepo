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
 * same payment has two buttons. They are deliberately NOT independent: `onPay`,
 * `payDisabled` and `payLabel` are the bar's own handler, gate and label,
 * passed down. Deriving a second `canPay` here from `useCheckout()` would let
 * the two disagree — the card could still look armed while the bar is
 * mid-submit, which is exactly how a double charge gets in. The label is
 * threaded for the milder version of the same failure: this card used to print
 * its own "Confirmar compra" next to a bar that said "Pagar".
 */
import type { LucideIcon } from "lucide-react"
import {
  AlertCircle,
  CloudRain,
  Heart,
  Home,
  Loader2,
  ShoppingBag,
  Utensils,
  X,
} from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { TicketingStepPublic } from "@/client"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import { CornerFrame } from "./Ornaments"
import { SectionShell, shellCopy } from "./SectionShell"

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
  icon: LucideIcon
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
  payLabel,
  stepConfig,
}: {
  onGoToTickets?: () => void
  /** The stepper's own payment handler — see the header note on why this is
   *  passed in rather than pulled from `useCheckout()` here. */
  onPay?: () => void
  payDisabled?: boolean
  /** The bottom bar's own CTA label, so both triggers for this payment read
   *  the same. Passed in for the same reason `onPay` is — there is
   *  deliberately no local fallback, since re-deriving it here is exactly how
   *  the two came to disagree. */
  payLabel?: string
  /** The organizer's confirm step, when one is configured — it names this
   *  section. Optional: the funnel shows a confirm step whether or not a row
   *  exists for it, and then the skin's own copy stands in. */
  stepConfig?: TicketingStepPublic | null
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

  // `summary.subtotal` already contains the service fee (useCartSummary.ts:
  // `originalSubtotal`), but the ladder below prints that fee as its own line
  // on the way to the Total — so showing it raw counted the fee twice on
  // screen and, with nothing discounted, made Subtotal and Total identical.
  // Taking it out is what makes the column add up: subtotal − adjustments +
  // fee = total. Insurance stays in, deliberately: it has no line of its own
  // down here, so pulling it out would leave the arithmetic short instead.
  const subtotalBeforeFee = summary.subtotal - summary.contributionSubtotal

  const copy = shellCopy(stepConfig, {
    kicker: t("checkout.amanita.confirm_kicker"),
    title: t("checkout.amanita.confirm_title"),
    intro: t("checkout.amanita.confirm_intro"),
  })

  if (!hasCartItems) {
    return (
      /* No intro here even when one is configured: it describes reviewing an
         order, and there is nothing to review yet — the empty state says so
         in its own words. */
      <SectionShell gem="bold" kicker={copy.kicker} title={copy.title}>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          {/* The brand mark, not a shopping bag: this is the one spot on the
              skin where a generic e-commerce glyph stood in for it. Same asset
              and intrinsic size as the nav's "home" pill. `opacity-60` keeps
              the muting the icon it replaces had, so the title stays the loud
              thing here. */}
          <Image
            src="/checkout-skins/amanita/logo-hongo.webp"
            alt=""
            aria-hidden
            width={647}
            height={360}
            className="h-12 w-auto opacity-60"
          />
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
      kicker={copy.kicker}
      title={copy.title}
      intro={copy.intro}
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

          {/* Passes — no group heading: "Tu compra" already says what the
              list is, and the mockup runs the lines flat under it. */}
          {cart.passes.length > 0 && (
            <div className="px-5 py-4 md:px-8">
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
            return (
              <div key={stepType}>
                <div className="border-t" style={{ borderColor: ROW_BORDER }} />
                <div className="px-5 py-4 md:px-8">
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

          {/* Coupon — no rule above it: it reads as part of the order, and the
              only divider before the totals is the one the ladder sits on. */}
          {popup?.allows_coupons && hasDiscountableItems && (
            <>
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
          {/* Totals — the mockup's reading order: Subtotal (of the items, fee
              excluded), then every adjustment, then the service fee that gets
              added on, then the Total itself. Read top to bottom the column
              now arrives at the Total. Subtotal always shows: it is the top of
              that ladder, and hiding it whenever nothing was discounted left
              the fee looking like it was added to thin air. */}
          <div
            className="border-t px-5 py-4 md:px-8"
            style={{ borderColor: ROW_BORDER }}
          >
            <div
              className="flex items-center justify-between text-sm"
              style={{ color: MUTED }}
            >
              <p>{t("checkout.amanita.confirm_subtotal_label")}</p>
              <p className="font-condensed text-base">
                {formatCurrency(subtotalBeforeFee)}
              </p>
            </div>
            {summary.discount > 0 && (
              <div className="mt-1 flex items-center justify-between text-sm text-primary">
                <p>
                  {showEligibleQualifier
                    ? t("checkout.discount.promo_discount_eligible_label")
                    : t("checkout.amanita.confirm_discount_label")}
                </p>
                <p className="font-condensed text-base">
                  −{formatCurrency(summary.discount)}
                </p>
              </div>
            )}
            {isEditing && editCredit > 0 && (
              <div className="mt-1 flex items-center justify-between text-sm text-primary">
                <p>{t("checkout.amanita.confirm_edit_credit_label")}</p>
                <p className="font-condensed text-base">
                  −{formatCurrency(editCredit)}
                </p>
              </div>
            )}
            {monthUpgradeCredit > 0 && (
              <div className="mt-1 flex items-center justify-between text-sm text-primary">
                <p>{t("checkout.amanita.confirm_credit_label")}</p>
                <p className="font-condensed text-base">
                  −{formatCurrency(monthUpgradeCredit)}
                </p>
              </div>
            )}
            {accountCredit > 0 && (
              <div className="mt-1 flex items-center justify-between text-sm text-primary">
                <p>{t("checkout.amanita.confirm_account_credit_label")}</p>
                <p className="font-condensed text-base">
                  −{formatCurrency(accountCredit)}
                </p>
              </div>
            )}
            {summary.contributionSubtotal > 0 && (
              <>
                <div
                  className="mt-1 flex items-center justify-between gap-3 text-sm"
                  style={{ color: MUTED }}
                >
                  <p className="min-w-0">
                    {popup?.contribution_label ||
                      t("checkout.contribution.fallbackLabel")}
                    {popup?.contribution_percentage
                      ? ` (${Number(popup.contribution_percentage)}%)`
                      : ""}
                  </p>
                  <p className="shrink-0 font-condensed text-base">
                    {formatCurrency(summary.contributionSubtotal)}
                  </p>
                </div>
                {popup?.contribution_description && (
                  <p className="mt-1 text-xs" style={{ color: MUTED }}>
                    {popup.contribution_description}
                  </p>
                )}
              </>
            )}
            <div className="mt-2 flex items-end justify-between">
              <p className="font-condensed text-sm font-medium uppercase tracking-[0.2em] text-primary">
                {t("checkout.amanita.confirm_total_label")}
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
          </div>

          {/* Terms — after the ladder, next to the button they gate. */}
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

          {onPay && (
            <div className="px-5 pb-5 md:px-8 md:pb-8">
              <button
                type="button"
                onClick={onPay}
                disabled={payDisabled}
                className="btn-ornate-2 btn-gold-fill ck-gold flex w-full items-center justify-center whitespace-nowrap py-3 font-condensed text-sm font-medium uppercase tracking-[0.12em] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {payLabel}
              </button>
            </div>
          )}
        </div>
      </CornerFrame>
    </SectionShell>
  )
}
