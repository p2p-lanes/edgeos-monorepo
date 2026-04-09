"use client"

import gsap from "gsap"
import { ScrollToPlugin } from "gsap/ScrollToPlugin"
import {
  ArrowLeft,
  ArrowRight,
  Heart,
  Home,
  Loader2,
  Shield,
  ShoppingBag,
  Tag,
  Ticket,
  X,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSidebar } from "@/components/Sidebar/SidebarComponents"
import {
  DesignVariantProvider,
  useDesignVariant,
} from "@/context/designVariant"
import { usePaymentVerification } from "@/hooks/checkout"
import { useIsMobile } from "@/hooks/useIsMobile"
import { cn } from "@/lib/utils"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeeCategory } from "@/types/Attendee"
import { formatCurrency } from "@/types/checkout"
import CartFooter from "./CartFooter"
import DesignVariantPanel from "./DesignVariantPanel"
import DynamicProductStep from "./DynamicProductStep"
import {
  STEP_COMPONENT_REGISTRY,
  shouldUseDynamicStep,
} from "./registries/stepRegistry"
import ScrollySection from "./ScrollySection"
import ScrollySectionNav, {
  type FooterDesign,
  type NavDesign,
  type WatermarkStyle,
} from "./ScrollySectionNav"
import PassSelectionSection from "./steps/PassSelectionSection"
import SuccessStep from "./steps/SuccessStep"

gsap.registerPlugin(ScrollToPlugin)

interface ScrollyCheckoutFlowProps {
  onAddAttendee?: (category: AttendeeCategory) => void
  onPaymentComplete?: () => void
  onBack?: () => void
}

const FOOTER_MODE_STORAGE_KEY = "passes-footer-mode"
const FOOTER_DESIGN_STORAGE_KEY = "passes-footer-design"
const NAV_DESIGN_STORAGE_KEY = "passes-nav-design"
const WATERMARK_STYLE_STORAGE_KEY = "passes-watermark-style"

function SectionHeader({
  title,
  subtitle,
  variant,
  watermark,
  watermarkStyle = "none",
  showTitle = true,
  showWatermark = true,
}: {
  title: string
  subtitle?: string
  variant?: string
  watermark?: string
  watermarkStyle?: WatermarkStyle
  showTitle?: boolean
  showWatermark?: boolean
}) {
  if (variant === "snap") {
    const watermarkText = watermark ?? title
    const watermarkClassName = cn(
      "absolute sm:-top-8 left-0 sm:text-[7rem] -top-4 text-[5rem] font-black leading-none select-none pointer-events-none truncate whitespace-nowrap z-[5]",
      watermarkStyle === "none" && "text-white",
      watermarkStyle === "ghost" && "text-gray-100",
      watermarkStyle === "stroke" && "text-white",
      watermarkStyle === "bold" && "text-gray-200",
    )
    const watermarkInlineStyle =
      watermarkStyle === "stroke"
        ? { WebkitTextStroke: "1px #d1d5db" }
        : undefined
    return (
      <>
        <div className="mb-8">
          <div className="relative min-h-[2rem] sm:min-h-[3rem]">
            {showWatermark && (
              <p
                aria-hidden="true"
                className={watermarkClassName}
                style={watermarkInlineStyle}
              >
                {watermarkText.split("").map((char, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: static decorative chars
                    key={i}
                    data-watermark-char
                    style={{ display: "inline-block" }}
                  >
                    {char === " " ? "\u00A0" : char}
                  </span>
                ))}
              </p>
            )}
            {showTitle && (
              <h2
                data-section-title
                className="relative text-2xl sm:text-4xl font-bold tracking-tight text-heading z-10 drop-shadow-[0_0_12px_rgba(255,255,255,0.9)]"
              >
                {title}
              </h2>
            )}
          </div>
        </div>
        {subtitle && (
          <p
            data-section-subtitle
            className="text-base sm:text-lg text-heading-secondary my-2 bg-black/5 rounded px-1 w-fit"
          >
            {subtitle}
          </p>
        )}
      </>
    )
  }

  return (
    <div className="mb-4">
      {showTitle && (
        <h2 className="text-xl font-bold tracking-tight text-heading">
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="text-sm text-heading-secondary mt-0.5">{subtitle}</p>
      )}
    </div>
  )
}

function SnapSection({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const watermarkChars = Array.from(
      el.querySelectorAll<HTMLElement>("[data-watermark-char]"),
    )
    const titleEl = el.querySelector<HTMLElement>("[data-section-title]")
    const subtitleEl = el.querySelector<HTMLElement>("[data-section-subtitle]")

    if (visible) {
      if (watermarkChars.length > 0) {
        gsap.fromTo(
          watermarkChars,
          { opacity: 0, y: 60, filter: "blur(8px)" },
          {
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 0.7,
            ease: "power3.out",
            stagger: { each: 0.04, from: "start" },
          },
        )
      }
      if (titleEl) {
        gsap.fromTo(
          titleEl,
          { opacity: 0, x: -32 },
          { opacity: 1, x: 0, duration: 0.55, ease: "power2.out", delay: 0.1 },
        )
      }
      if (subtitleEl) {
        gsap.fromTo(
          subtitleEl,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.45, ease: "power1.out", delay: 0.3 },
        )
      }
    } else {
      if (watermarkChars.length > 0) {
        gsap.set(watermarkChars, { opacity: 0, y: 60, filter: "blur(8px)" })
      }
      if (titleEl) {
        gsap.set(titleEl, { opacity: 0, x: -32 })
      }
      if (subtitleEl) {
        gsap.set(subtitleEl, { opacity: 0, y: 8 })
      }
    }

    return () => {
      gsap.killTweensOf(
        [...watermarkChars, titleEl, subtitleEl].filter(Boolean),
      )
    }
  }, [visible])

  return (
    <section
      id={id}
      ref={ref}
      className="flex flex-col justify-start px-4 pb-16 max-w-2xl mx-auto"
      style={{
        minHeight: "var(--snap-section-h, 100vh)",
        paddingTop: "calc(var(--snap-nav-h, 48px) + 1.5rem)",
      }}
    >
      {children}
    </section>
  )
}

function SnapDotNav({
  sections,
  activeSection,
  onDotClick,
}: {
  sections: { id: string; label: string }[]
  activeSection: string
  onDotClick: (index: number) => void
}) {
  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2">
      {sections.map(({ id, label }, index) => (
        <button
          key={id}
          type="button"
          onClick={() => onDotClick(index)}
          title={label}
          className={cn(
            "w-2 h-2 rounded-full transition-all duration-200",
            activeSection === id
              ? "bg-gray-900 scale-150"
              : "bg-gray-300 hover:bg-gray-500",
          )}
        />
      ))}
    </div>
  )
}

function CartDrawerContent() {
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
  } = useCheckout()

  const hasItems =
    cart.passes.length > 0 ||
    !!cart.housing ||
    cart.merch.length > 0 ||
    !!cart.patron ||
    !!cart.insurance ||
    cart.promoCodeValid

  const getAttendeeName = (attendeeId: string): string => {
    const attendee = attendees.find((a) => a.id === attendeeId)
    return attendee?.name || "Unknown"
  }

  const handleRemovePass = (attendeeId: string, productId: string) => {
    const pass = cart.passes.find(
      (p) => p.attendeeId === attendeeId && p.productId === productId,
    )
    if (pass?.product.duration_type === "day") {
      resetDayProduct(attendeeId, productId)
    } else {
      togglePass(attendeeId, productId)
    }
  }

  return (
    <div className="bg-white shadow-2xl rounded-2xl mb-2 relative z-30 max-h-[60vh] overflow-hidden">
      <div className="px-4 py-4 overflow-y-auto max-h-[calc(60vh-80px)]">
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
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {getAttendeeName(pass.attendeeId)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {pass.product.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
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
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {cart.housing.product.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {cart.housing.pricePerDay !== false
                      ? `${cart.housing.nights} night${cart.housing.nights !== 1 ? "s" : ""}`
                      : "Full stay"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
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
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {item.product.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        Qty: {item.quantity}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
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
                <span className="text-sm font-medium text-gray-900">
                  Community Support
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
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

        {/* Insurance */}
        {cart.insurance && summary.insuranceSubtotal > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Pass Protection
            </h4>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-sm font-medium text-gray-900">
                  Coverage for all passes
                </span>
              </div>
              <span className="text-sm font-medium text-gray-900">
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
            <p className="text-gray-500">Your cart is empty</p>
          </div>
        )}
      </div>
    </div>
  )
}

function QuickPayFooter({
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
    <div className="mb-4">
      <div className="backdrop-blur-xl bg-gray-900/95 rounded-2xl shadow-2xl border border-white/10 p-3 lg:p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onCartToggle}
            className="relative flex items-center justify-center p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0"
          >
            <ShoppingBag className="w-4 h-4" />
            {itemCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-white text-gray-900 text-[9px] rounded-full flex items-center justify-center font-bold">
                {itemCount}
              </span>
            )}
          </button>

          <div className="flex-1 flex flex-col items-start min-w-0 overflow-hidden">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
              Total
            </span>
            <span className="text-2xl font-bold text-white truncate max-w-full">
              {formatCurrency(summary.grandTotal)}
            </span>
          </div>

          {cart.passes.length === 0 ? (
            <span className="text-gray-400 text-xs text-right max-w-[80px]">
              Add passes first
            </span>
          ) : !isOnConfirm ? (
            <button
              type="button"
              onClick={onGoToConfirm}
              className="flex items-center gap-1.5 px-4 py-3 rounded-xl font-semibold text-sm bg-white text-gray-900 hover:bg-gray-100 shadow-lg active:scale-95 shrink-0 whitespace-nowrap"
            >
              Review <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
          ) : requiresTerms ? (
            <span className="text-gray-400 text-xs text-right max-w-[80px]">
              Accept terms to pay
            </span>
          ) : (
            <button
              type="button"
              onClick={onPay}
              disabled={!canPay}
              className={cn(
                "flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-semibold text-sm transition-all shrink-0 whitespace-nowrap",
                canPay
                  ? "bg-white text-gray-900 hover:bg-gray-100 shadow-lg active:scale-95"
                  : "bg-white/20 text-gray-400 cursor-not-allowed",
              )}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {summary.grandTotal === 0 ? "Claim Pass" : "Pay Now"}
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StripeFooter({
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
    <div className="mb-4 bg-white/80 backdrop-blur-md border-t border-gray-200 rounded-2xl shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-gray-500 hover:text-gray-900 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCartToggle}
          className="relative text-gray-500 hover:text-gray-900 hover:bg-gray-100 p-1.5 rounded-lg transition-colors shrink-0"
        >
          <ShoppingBag className="w-4 h-4" />
          {itemCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-gray-900 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
              {itemCount}
            </span>
          )}
        </button>
        <div className="flex-1 flex flex-col items-center">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">
            Total
          </span>
          <span className="text-lg font-bold text-gray-900">
            {formatCurrency(summary.grandTotal)}
          </span>
        </div>
        {!isOnConfirm && cart.passes.length > 0 ? (
          <button
            type="button"
            onClick={onGoToConfirm}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-700 shrink-0"
          >
            Review
          </button>
        ) : (
          <button
            type="button"
            onClick={onPay}
            disabled={!canPay}
            className={cn(
              "px-5 py-2 rounded-xl text-sm font-semibold transition-all shrink-0",
              canPay
                ? "bg-gray-900 text-white hover:bg-gray-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed",
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
        className="w-12 h-12 rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 flex items-center justify-center hover:scale-110 transition-transform"
      >
        <ArrowLeft className="w-5 h-5 text-gray-700" />
      </button>
      {/* cart badge */}
      <button
        type="button"
        onClick={onCartToggle}
        className="relative w-12 h-12 rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 flex items-center justify-center hover:scale-110 transition-transform"
      >
        <ShoppingBag className="w-5 h-5 text-gray-700" />
        {itemCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-gray-900 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
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
              ? "bg-gray-900 text-white"
              : "bg-white/60 text-gray-400 cursor-not-allowed border border-gray-200",
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
              ? "bg-gray-900 text-white"
              : "bg-white/60 text-gray-400 cursor-not-allowed border border-gray-200",
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

function SnapFooter({
  footerMode,
  footerDesign,
  onPay,
  onBack,
  activeSection,
  onGoToConfirm,
}: {
  footerMode: "guided" | "quickpay"
  footerDesign: FooterDesign
  onPay?: () => void
  onBack?: () => void
  activeSection?: string
  onGoToConfirm?: () => void
}) {
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

  const footer = {
    pill:
      footerMode === "quickpay" ? (
        <QuickPayFooter
          onPay={onPay}
          onBack={onBack}
          onCartToggle={() => setIsCartOpen((v) => !v)}
          itemCount={itemCount}
          isOnConfirm={isOnConfirm}
          onGoToConfirm={onGoToConfirm}
        />
      ) : (
        <CartFooter onPay={onPay} onBack={onBack} />
      ),
    stripe: (
      <StripeFooter
        onPay={onPay}
        onBack={onBack}
        onCartToggle={() => setIsCartOpen((v) => !v)}
        itemCount={itemCount}
        isOnConfirm={isOnConfirm}
        onGoToConfirm={onGoToConfirm}
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
      style={{ left: leftOffset, right: 0 }}
    >
      <div className="max-w-2xl mx-auto px-4">
        {isCartOpen && <CartDrawerContent />}
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

function ScrollyCheckoutFlowInner({
  onAddAttendee,
  onPaymentComplete,
  onBack,
}: ScrollyCheckoutFlowProps) {
  const { variant } = useDesignVariant()
  const { availableSteps, submitPayment, stepConfigs } = useCheckout()

  const getStepConfig = (stepType: string) =>
    stepConfigs.find(
      (s) =>
        s.step_type === stepType ||
        (s.step_type === "tickets" && stepType === "passes"),
    )

  const searchParams = useSearchParams()
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()

  const isSimpleFIReturn = useMemo(
    () => searchParams.has("checkout", "success"),
    [searchParams],
  )

  const { paymentStatus } = usePaymentVerification({
    applicationId: application?.id,
    enabled: isSimpleFIReturn,
  })

  const handlePayment = async () => {
    const result = await submitPayment()
    if (result.success) {
      onPaymentComplete?.()
    }
  }

  const [activeSection, setActiveSection] = useState<string>("passes")
  // Ref to expose GSAP scrollToIndex to dot nav (stable across renders)
  const scrollToIndexRef = useRef<((index: number) => void) | null>(null)

  // Footer mode (only used in snap variant)
  const [footerMode, setFooterMode] = useState<"guided" | "quickpay">("guided")
  const [footerDesign, setFooterDesign] = useState<FooterDesign>("stripe")
  const [navDesign, setNavDesign] = useState<NavDesign>("pills")
  const [watermarkStyle, setWatermarkStyle] = useState<WatermarkStyle>("none")

  useEffect(() => {
    const storedMode = localStorage.getItem(FOOTER_MODE_STORAGE_KEY) as
      | "guided"
      | "quickpay"
      | null
    if (storedMode === "guided" || storedMode === "quickpay") {
      setFooterMode(storedMode)
    }
    const storedDesign = localStorage.getItem(
      FOOTER_DESIGN_STORAGE_KEY,
    ) as FooterDesign | null
    if (
      storedDesign === "pill" ||
      storedDesign === "stripe" ||
      storedDesign === "dock"
    ) {
      setFooterDesign(storedDesign)
    }
    const storedNavDesign = localStorage.getItem(
      NAV_DESIGN_STORAGE_KEY,
    ) as NavDesign | null
    if (
      storedNavDesign === "pills" ||
      storedNavDesign === "progress" ||
      storedNavDesign === "underline"
    ) {
      setNavDesign(storedNavDesign)
    }
    const storedWatermark = localStorage.getItem(
      WATERMARK_STYLE_STORAGE_KEY,
    ) as WatermarkStyle | null
    if (
      storedWatermark === "none" ||
      storedWatermark === "ghost" ||
      storedWatermark === "stroke" ||
      storedWatermark === "bold"
    ) {
      setWatermarkStyle(storedWatermark)
    }
  }, [])

  const _toggleFooterMode = () => {
    const next = footerMode === "guided" ? "quickpay" : "guided"
    setFooterMode(next)
    localStorage.setItem(FOOTER_MODE_STORAGE_KEY, next)
  }

  const setFooterDesignPersisted = (v: FooterDesign) => {
    setFooterDesign(v)
    localStorage.setItem(FOOTER_DESIGN_STORAGE_KEY, v)
  }

  const setNavDesignPersisted = (v: NavDesign) => {
    setNavDesign(v)
    localStorage.setItem(NAV_DESIGN_STORAGE_KEY, v)
  }

  const setWatermarkStylePersisted = (v: WatermarkStyle) => {
    setWatermarkStyle(v)
    localStorage.setItem(WATERMARK_STYLE_STORAGE_KEY, v)
  }

  // Build sections list from availableSteps (respects is_enabled + order + product availability)
  const allSections = useMemo(() => {
    return availableSteps
      .filter((s) => s !== "success")
      .map((step) => {
        const config = stepConfigs.find(
          (c) =>
            c.step_type === step ||
            (c.step_type === "tickets" && step === "passes"),
        )
        const defaultLabels: Record<string, string> = {
          passes: "Select Your Passes",
          tickets: "Select Your Passes",
          housing: "Choose Housing",
          merch: "Event Merchandise",
          patron: "Become a Patron",
          confirm: "Review & Confirm",
        }
        return {
          id: step,
          label: config?.title ?? defaultLabels[step] ?? step,
        }
      })
  }, [availableSteps, stepConfigs])

  const goToConfirm = useCallback(() => {
    const idx = allSections.findIndex((s) => s.id === "confirm")
    scrollToIndexRef.current?.(idx)
  }, [allSections])

  // Scroll-to-section handler for the scrolly variant nav bar
  const scrollToSection = useCallback((sectionId: string) => {
    const target = document.getElementById(sectionId)
    if (!target) return

    // Walk up to find the scroll container
    let scrollContainer: HTMLElement | null = target.parentElement
    while (scrollContainer && scrollContainer !== document.documentElement) {
      const { overflowY, overflow } = getComputedStyle(scrollContainer)
      if (/(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflow)) {
        break
      }
      scrollContainer = scrollContainer.parentElement
    }
    if (!scrollContainer || scrollContainer === document.documentElement) return

    const targetTop =
      scrollContainer.scrollTop +
      target.getBoundingClientRect().top -
      scrollContainer.getBoundingClientRect().top -
      56 // offset for sticky nav height

    gsap.to(scrollContainer, {
      scrollTo: { y: targetTop },
      duration: 0.6,
      ease: "power2.inOut",
    })
  }, [])

  // IntersectionObserver to track active section in scrolly variant
  useEffect(() => {
    if (variant !== "scrolly") return

    const sectionIds = allSections.map((s) => s.id)
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[]

    if (elements.length === 0) return

    // Find scroll container
    let root: Element | null = null
    let parent = elements[0].parentElement
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent)
      if (
        /(auto|scroll)/.test(style.overflowY) ||
        /(auto|scroll)/.test(style.overflow)
      ) {
        root = parent
        break
      }
      parent = parent.parentElement
    }

    const visibleSections = new Set<string>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleSections.add(entry.target.id)
          } else {
            visibleSections.delete(entry.target.id)
          }
        }
        // Pick the first visible section in document order
        for (const id of sectionIds) {
          if (visibleSections.has(id)) {
            setActiveSection(id)
            break
          }
        }
      },
      {
        root: root as Element | null,
        rootMargin: "-48px 0px -40% 0px",
        threshold: 0,
      },
    )

    for (const el of elements) {
      observer.observe(el)
    }

    return () => observer.disconnect()
  }, [variant, allSections])

  // GSAP-powered snap scroll — blocks native scroll, animates between sections
  useEffect(() => {
    if (variant !== "snap") return

    // SidebarInset also renders a <main>, so querySelector("main") returns the
    // outer overflow:hidden shell. Find the real scrollable container by walking
    // up from the first section element.
    const findScrollContainer = (): HTMLElement | null => {
      const anchor = document.getElementById(allSections[0]?.id ?? "passes")
      if (!anchor) return null
      let node: HTMLElement | null = anchor.parentElement
      while (node && node !== document.documentElement) {
        const { overflowY, overflow } = getComputedStyle(node)
        if (/(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflow)) {
          return node
        }
        node = node.parentElement
      }
      return null
    }

    const mainEl = findScrollContainer()
    if (!mainEl) return

    mainEl.style.overscrollBehaviorY = "none"

    // Set CSS variable so SnapSection fills the exact scroll container height
    const updateHeight = () => {
      mainEl.style.setProperty("--snap-section-h", `${mainEl.clientHeight}px`)
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(mainEl)

    // Measure sticky nav height so SnapSection can pad content below it
    const navEl = mainEl.querySelector<HTMLElement>("[data-snap-nav]")
    const updateNavHeight = () => {
      const h = navEl?.getBoundingClientRect().height ?? 48
      mainEl.style.setProperty("--snap-nav-h", `${h}px`)
    }
    updateNavHeight()
    const navRo = new ResizeObserver(updateNavHeight)
    if (navEl) navRo.observe(navEl)

    // Compute the scrollTop needed to align an element's top with the container top
    const getScrollTop = (el: HTMLElement): number =>
      mainEl.scrollTop +
      el.getBoundingClientRect().top -
      mainEl.getBoundingClientRect().top

    // Snapshot sections at effect creation time
    const sectionsSnapshot = allSections
    const currentSection = { current: 0 }
    const isAnimating = { current: false }

    const scrollToIndex = (index: number) => {
      const clamped = Math.max(0, Math.min(index, sectionsSnapshot.length - 1))
      const el = document.getElementById(sectionsSnapshot[clamped].id)
      if (!el || isAnimating.current) return

      isAnimating.current = true
      currentSection.current = clamped
      setActiveSection(sectionsSnapshot[clamped].id)

      gsap.to(mainEl, {
        scrollTo: { y: getScrollTop(el), autoKill: false },
        duration: 0.75,
        ease: "power2.inOut",
        onComplete: () => {
          isAnimating.current = false
        },
      })
    }

    // Expose for dot nav
    scrollToIndexRef.current = scrollToIndex

    // Returns the section's absolute top in scroll-space (independent of current scrollTop)
    const getSectionScrollTop = (el: HTMLElement): number =>
      mainEl.scrollTop +
      el.getBoundingClientRect().top -
      mainEl.getBoundingClientRect().top

    // Update currentSection based on scroll position (used during free scrolling within a section)
    const updateCurrentSection = () => {
      if (isAnimating.current) return
      const scrollTop = mainEl.scrollTop
      let active = 0
      for (let i = 0; i < sectionsSnapshot.length; i++) {
        const el = document.getElementById(sectionsSnapshot[i].id)
        if (!el) continue
        if (scrollTop >= getSectionScrollTop(el) - 10) active = i
      }
      if (active !== currentSection.current) {
        currentSection.current = active
        setActiveSection(sectionsSnapshot[active].id)
      }
    }

    // Returns true if scrolling `dir` should snap (we're at a section boundary)
    const atBoundary = (dir: 1 | -1): boolean => {
      const el = document.getElementById(
        sectionsSnapshot[currentSection.current].id,
      )
      if (!el) return true
      const sectionTop = getSectionScrollTop(el)
      const sectionBottom = sectionTop + el.offsetHeight
      const scrollTop = mainEl.scrollTop
      const containerBottom = scrollTop + mainEl.clientHeight
      if (dir > 0) return containerBottom >= sectionBottom - 5
      return scrollTop <= sectionTop + 5
    }

    const handleWheel = (e: WheelEvent) => {
      if (isAnimating.current) {
        e.preventDefault()
        return
      }
      const dir = e.deltaY > 0 ? 1 : -1
      if (!atBoundary(dir)) return // let the browser scroll naturally within the section
      e.preventDefault()
      scrollToIndex(currentSection.current + dir)
    }

    let touchStartY = 0
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY
    }
    const handleTouchMove = (e: TouchEvent) => {
      // Only block native scroll while a snap animation is running
      if (isAnimating.current) e.preventDefault()
    }
    const handleTouchEnd = (e: TouchEvent) => {
      const dy = touchStartY - e.changedTouches[0].clientY
      if (Math.abs(dy) < 30 || isAnimating.current) return
      const dir = dy > 0 ? 1 : -1
      if (!atBoundary(dir)) return
      scrollToIndex(currentSection.current + dir)
    }

    mainEl.addEventListener("scroll", updateCurrentSection)
    mainEl.addEventListener("wheel", handleWheel, { passive: false })
    mainEl.addEventListener("touchstart", handleTouchStart)
    mainEl.addEventListener("touchmove", handleTouchMove, { passive: false })
    mainEl.addEventListener("touchend", handleTouchEnd)

    return () => {
      mainEl.style.overscrollBehaviorY = ""
      mainEl.style.removeProperty("--snap-section-h")
      mainEl.style.removeProperty("--snap-nav-h")
      mainEl.removeEventListener("scroll", updateCurrentSection)
      mainEl.removeEventListener("wheel", handleWheel)
      mainEl.removeEventListener("touchstart", handleTouchStart)
      mainEl.removeEventListener("touchmove", handleTouchMove)
      mainEl.removeEventListener("touchend", handleTouchEnd)
      gsap.killTweensOf(mainEl)
      ro.disconnect()
      navRo.disconnect()
      scrollToIndexRef.current = null
    }
  }, [variant, allSections])

  const renderSectionContent = (stepId: string) => {
    // Passes/tickets: special case — PassSelectionSection needs onAddAttendee
    if (stepId === "passes" || stepId === "tickets") {
      const ticketConfig = getStepConfig("tickets") ?? getStepConfig("passes")
      if (shouldUseDynamicStep(ticketConfig)) {
        return (
          <DynamicProductStep stepConfig={ticketConfig!} onSkip={() => {}} />
        )
      }
      return <PassSelectionSection onAddAttendee={onAddAttendee} />
    }

    // All other steps: check dynamic template first, then fallback registry
    const config = getStepConfig(stepId)

    if (shouldUseDynamicStep(config)) {
      return <DynamicProductStep stepConfig={config!} onSkip={() => {}} />
    }

    const FallbackComponent = STEP_COMPONENT_REGISTRY[stepId]
    if (FallbackComponent) {
      return <FallbackComponent onSkip={() => {}} />
    }

    // Unknown step with config: try dynamic as last resort
    if (config) {
      return <DynamicProductStep stepConfig={config} onSkip={() => {}} />
    }

    return null
  }

  if (isSimpleFIReturn) {
    return (
      <div className="min-h-screen">
        <SuccessStep paymentStatus={paymentStatus} />
      </div>
    )
  }

  // --- SNAP VARIANT ---
  if (variant === "snap") {
    return (
      <div className="relative font-sans">
        <ScrollySectionNav
          sections={allSections}
          activeSection={activeSection}
          onSectionClick={(sectionId) => {
            const idx = allSections.findIndex((s) => s.id === sectionId)
            if (idx >= 0) scrollToIndexRef.current?.(idx)
          }}
          variant={navDesign}
        />
        {/* Sections — overflow/scroll is applied to <main> via useEffect */}
        {allSections.map((section) => {
          const config = getStepConfig(section.id)
          return (
            <SnapSection key={section.id} id={section.id}>
              <SectionHeader
                title={config?.title ?? section.label}
                subtitle={config?.description ?? undefined}
                variant="snap"
                watermark={config?.watermark ?? section.label}
                watermarkStyle={watermarkStyle}
                showTitle={config?.show_title ?? true}
                showWatermark={config?.show_watermark ?? true}
              />
              {renderSectionContent(section.id)}
            </SnapSection>
          )
        })}

        <DesignVariantPanel
          navDesign={navDesign}
          onNavDesignChange={setNavDesignPersisted}
          footerDesign={footerDesign}
          onFooterDesignChange={setFooterDesignPersisted}
          watermarkStyle={watermarkStyle}
          onWatermarkStyleChange={setWatermarkStylePersisted}
        />
        <SnapDotNav
          sections={allSections}
          activeSection={activeSection}
          onDotClick={(i) => scrollToIndexRef.current?.(i)}
        />

        <SnapFooter
          footerMode={footerMode}
          footerDesign={footerDesign}
          onPay={handlePayment}
          onBack={onBack}
          activeSection={activeSection}
          onGoToConfirm={goToConfirm}
        />
      </div>
    )
  }

  // --- SCROLLY VARIANT (default) ---
  return (
    <div data-variant={variant} className="relative min-h-screen font-sans">
      <ScrollySectionNav
        sections={allSections}
        activeSection={activeSection}
        onSectionClick={scrollToSection}
        variant={navDesign}
      />
      <main className="max-w-2xl mx-auto px-4 pt-6 pb-32">
        {allSections.map((section) => {
          const config = getStepConfig(section.id)
          return (
            <ScrollySection key={section.id} id={section.id}>
              <SectionHeader
                title={config?.title ?? section.label}
                subtitle={config?.description ?? undefined}
                showTitle={config?.show_title ?? true}
              />
              {renderSectionContent(section.id)}
            </ScrollySection>
          )
        })}
      </main>

      <DesignVariantPanel
        navDesign={navDesign}
        onNavDesignChange={setNavDesignPersisted}
        footerDesign={footerDesign}
        onFooterDesignChange={setFooterDesignPersisted}
        watermarkStyle={watermarkStyle}
        onWatermarkStyleChange={setWatermarkStylePersisted}
      />

      <div className="sticky bottom-0 z-30">
        <div className="max-w-2xl mx-auto px-4">
          <CartFooter onPay={handlePayment} onBack={onBack} />
        </div>
      </div>
    </div>
  )
}

export default function ScrollyCheckoutFlow(props: ScrollyCheckoutFlowProps) {
  return (
    <DesignVariantProvider>
      <ScrollyCheckoutFlowInner {...props} />
    </DesignVariantProvider>
  )
}
