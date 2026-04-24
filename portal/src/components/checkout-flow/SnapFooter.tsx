"use client"

import { ArrowLeft, ArrowRight, Loader2, ShoppingBag } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useSidebar } from "@/components/Sidebar/SidebarComponents"
import { useIsMobile } from "@/hooks/useIsMobile"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCurrency } from "@/types/checkout"
import CartFooter from "./CartFooter"
import CartItemList from "./CartItemList"
import type { FooterDesign } from "./ScrollySectionNav"

interface SnapFooterSection {
  id: string
  label: string
}

function StripeFooter({
  onPay,
  onBack,
  onCartToggle,
  itemCount = 0,
  isOnConfirm,
  onGoToConfirm,
  onGoToNextSection,
  nextSectionLabel,
}: {
  onPay?: () => void
  onBack?: () => void
  onCartToggle?: () => void
  itemCount?: number
  isOnConfirm?: boolean
  onGoToConfirm?: () => void
  onGoToNextSection?: () => void
  nextSectionLabel?: string
}) {
  const { t } = useTranslation()
  const { cart, summary, isSubmitting, termsAccepted } = useCheckout()
  const { getCity } = useCityProvider()
  const popup = getCity()
  const requiresTerms = !!popup?.terms_and_conditions_url && !termsAccepted
  const canPay = cart.passes.length > 0 && !requiresTerms && !isSubmitting

  return (
    <div className="mb-4 bg-checkout-footer-bg backdrop-blur-md border-t border-gray-200 rounded-2xl shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-checkout-subtitle hover:text-checkout-title transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCartToggle}
          className="relative text-checkout-subtitle hover:text-checkout-title hover:bg-gray-100 p-1.5 rounded-lg transition-colors shrink-0"
        >
          <ShoppingBag className="w-4 h-4" />
          {itemCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-checkout-badge-bg text-checkout-badge-title text-[9px] rounded-full flex items-center justify-center font-bold">
              {itemCount}
            </span>
          )}
        </button>
        <div className="flex-1 flex flex-col items-center">
          <span className="text-[10px] text-checkout-subtitle uppercase tracking-wider">
            Total
          </span>
          <span className="text-lg font-bold text-checkout-title">
            {formatCurrency(summary.grandTotal)}
          </span>
        </div>
        {!isOnConfirm && cart.passes.length > 0 ? (
          <button
            type="button"
            onClick={nextSectionLabel ? onGoToNextSection : onGoToConfirm}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-checkout-badge-bg text-checkout-badge-title hover:opacity-90 shrink-0"
          >
            {nextSectionLabel ?? t("checkout.actions.review")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onPay}
            disabled={!canPay}
            className={cn(
              "px-5 py-2 rounded-xl text-sm font-semibold transition-all shrink-0",
              canPay
                ? "bg-checkout-button text-checkout-button-title hover:opacity-90"
                : "bg-checkout-button-disabled text-checkout-button-title-disabled cursor-not-allowed",
            )}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : summary.grandTotal === 0 ? (
              "Claim"
            ) : (
              "Pay"
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function DockFooter({
  onPay,
  onBack,
  onCartToggle,
  itemCount = 0,
  isOnConfirm,
  onGoToConfirm,
}: {
  onPay?: () => void
  onBack?: () => void
  onCartToggle?: () => void
  itemCount?: number
  isOnConfirm?: boolean
  onGoToConfirm?: () => void
}) {
  const { cart, summary, isSubmitting, termsAccepted } = useCheckout()
  const { getCity } = useCityProvider()
  const popup = getCity()
  const requiresTerms = !!popup?.terms_and_conditions_url && !termsAccepted
  const canPay = cart.passes.length > 0 && !requiresTerms && !isSubmitting

  return (
    <div className="mb-4 flex items-end justify-center gap-2">
      {/* back */}
      <button
        type="button"
        onClick={onBack}
        className="w-12 h-12 rounded-2xl bg-checkout-card-bg/90 backdrop-blur-sm shadow-lg border border-gray-200 flex items-center justify-center hover:scale-110 transition-transform"
      >
        <ArrowLeft className="w-5 h-5 text-checkout-title" />
      </button>
      {/* cart badge */}
      <button
        type="button"
        onClick={onCartToggle}
        className="relative w-12 h-12 rounded-2xl bg-checkout-card-bg/90 backdrop-blur-sm shadow-lg border border-gray-200 flex items-center justify-center hover:scale-110 transition-transform"
      >
        <ShoppingBag className="w-5 h-5 text-checkout-title" />
        {itemCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-checkout-badge-bg text-checkout-badge-title text-[10px] rounded-full flex items-center justify-center font-bold">
            {itemCount}
          </span>
        )}
      </button>
      {/* navigate to confirm or pay */}
      {!isOnConfirm ? (
        <button
          type="button"
          onClick={onGoToConfirm}
          disabled={cart.passes.length === 0}
          className={cn(
            "h-12 px-5 rounded-2xl shadow-lg font-semibold text-sm flex items-center gap-2 hover:scale-105 transition-transform",
            cart.passes.length > 0
              ? "bg-checkout-button text-checkout-button-title"
              : "bg-checkout-button-disabled text-checkout-button-title-disabled cursor-not-allowed border border-gray-200",
          )}
        >
          {formatCurrency(summary.grandTotal)}{" "}
          <ArrowRight className="w-4 h-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPay}
          disabled={!canPay}
          className={cn(
            "h-12 px-5 rounded-2xl shadow-lg font-semibold text-sm flex items-center gap-2 hover:scale-105 transition-transform",
            canPay
              ? "bg-checkout-button text-checkout-button-title"
              : "bg-checkout-button-disabled text-checkout-button-title-disabled cursor-not-allowed border border-gray-200",
          )}
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              {formatCurrency(summary.grandTotal)}{" "}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </div>
  )
}

export default function SnapFooter({
  footerDesign,
  onPay,
  onBack,
  activeSection,
  sections,
  onGoToConfirm,
  onGoToNextSection,
}: {
  footerDesign: FooterDesign
  onPay?: () => void
  onBack?: () => void
  activeSection?: string
  sections?: SnapFooterSection[]
  onGoToConfirm?: () => void
  onGoToNextSection?: () => void
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { state: sidebarState } = useSidebar()
  const { cart } = useCheckout()
  const [isCartOpen, setIsCartOpen] = useState(false)

  const leftOffset = isMobile
    ? 0
    : sidebarState === "expanded"
      ? "var(--sidebar-width)"
      : "var(--sidebar-width-icon)"

  const itemCount =
    cart.passes.length +
    (cart.housing ? 1 : 0) +
    cart.merch.length +
    (cart.patron ? 1 : 0)

  const isOnConfirm = activeSection === "confirm"

  // Derive the label of the next section relative to the current activeSection,
  // falling back to the config title, and then to a localized short label.
  const getStepShortLabel = (id?: string): string | undefined => {
    if (!id) return undefined
    const key = `checkout.step_short.${id}`
    const translated = t(key)
    return translated === key ? undefined : translated
  }

  const activeIndex = sections?.findIndex((s) => s.id === activeSection) ?? -1
  const nextSection =
    sections && activeIndex >= 0 && activeIndex < sections.length - 1
      ? sections[activeIndex + 1]
      : undefined
  const nextSectionLabel = nextSection
    ? (getStepShortLabel(nextSection.id) ?? nextSection.label)
    : undefined

  const footer = {
    pill: (
      <CartFooter
        onPay={onPay}
        onBack={onBack}
        nextSectionLabel={nextSectionLabel}
        onContinue={onGoToNextSection}
        isLastSection={isOnConfirm}
      />
    ),
    stripe: (
      <StripeFooter
        onPay={onPay}
        onBack={onBack}
        onCartToggle={() => setIsCartOpen((v) => !v)}
        itemCount={itemCount}
        isOnConfirm={isOnConfirm}
        onGoToConfirm={onGoToConfirm}
        onGoToNextSection={onGoToNextSection}
        nextSectionLabel={nextSectionLabel}
      />
    ),
    dock: (
      <DockFooter
        onPay={onPay}
        onBack={onBack}
        onCartToggle={() => setIsCartOpen((v) => !v)}
        itemCount={itemCount}
        isOnConfirm={isOnConfirm}
        onGoToConfirm={onGoToConfirm}
      />
    ),
  }[footerDesign]

  return (
    <div
      className="fixed bottom-0 z-30 transition-[left] duration-200"
      style={{ left: leftOffset, right: "var(--snap-scrollbar-w, 0px)" }}
    >
      <div className="max-w-2xl mx-auto px-4">
        {isCartOpen && (
          <div className="bg-white shadow-2xl rounded-2xl mb-2 relative z-30 max-h-[60vh] overflow-hidden">
            <div className="px-4 py-4 overflow-y-auto max-h-[calc(60vh-80px)]">
              <CartItemList />
            </div>
          </div>
        )}
        {isCartOpen && (
          <button
            type="button"
            aria-label="Close cart"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setIsCartOpen(false)}
          />
        )}
        {footer}
      </div>
    </div>
  )
}
