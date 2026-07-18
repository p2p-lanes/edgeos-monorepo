"use client"

import { ArrowLeft, ArrowRight } from "lucide-react"
import Image from "next/image"
import type { CSSProperties } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader } from "@/components/ui/Loader"
import { type CheckoutSkin, resolveCheckoutSkin } from "@/lib/checkout-skin"
import { imageOptimization } from "@/lib/image-optimization"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCurrency } from "@/types/checkout"
import CheckoutToast from "./CheckoutToast"
import DynamicProductStep from "./DynamicProductStep"
import { deriveCheckoutSections } from "./deriveCheckoutSections"
import { shouldUseDynamicStep } from "./registries/stepRegistry"
import { CONTENT_ONLY_TEMPLATES } from "./registries/variantRegistry"
import type { ScrollyCheckoutFlowProps } from "./ScrollyCheckoutFlow"
import SectionHeader from "./SectionHeader"
import StepFootnotes from "./StepFootnotes"
import { AmanitaBackground } from "./skins/amanita/AmanitaBackground"
import AmanitaBuyerStep from "./skins/amanita/AmanitaBuyerStep"
import AmanitaCatalogSection from "./skins/amanita/AmanitaCatalogSection"
import AmanitaConfirmSection from "./skins/amanita/AmanitaConfirmSection"
import "./skins/amanita/amanita-skin.css"
import AmanitaStepFaqs from "./skins/amanita/AmanitaStepFaqs"
import FaqsDrawer, { type FaqDrawerItem } from "./skins/amanita/FaqsDrawer"
import { amanitaFontVars } from "./skins/amanita/fonts"
import ConfirmStep from "./steps/ConfirmStep"
import OpenCheckoutBuyerStep from "./steps/OpenCheckoutBuyerStep"
import PassSelectionSection from "./steps/PassSelectionSection"

/* Chrome (wrapper/nav/bottom-bar) className+style pairs per skin, keyed by
 * `CheckoutSkin`. `default` is the exact Plan 2 unskinned chrome; `amanita`
 * is ported from the mockup's `<header>`/pills nav and fixed bottom bar in
 * checkout-amanita/codigo/checkout/CheckoutExperience.tsx. Kept as small
 * per-element maps (rather than one big object) so each JSX spot stays a
 * simple `X[skin]` lookup. */
const ROOT_CLASSES: Record<CheckoutSkin, string> = {
  default: "relative min-h-svh font-sans",
  amanita: `checkout-amanita ${amanitaFontVars} section-dark relative min-h-dvh`,
}

/* The nav is two elements, mirroring BOTTOM_OUTER/BOTTOM_INNER below: a
 * full-bleed bar that paints the background, wrapping a constrained inner
 * <nav> that holds the pills. Putting `max-w-*` on the bar itself would clip
 * its background to that width — the mockup's <header>/<nav> pair
 * (checkout-amanita/codigo/checkout/CheckoutExperience.tsx:194-204) exists
 * for exactly this reason. */
const NAV_OUTER: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: {
    className: "sticky top-0 z-40 bg-background/90 backdrop-blur",
  },
  amanita: {
    className: "pointer-events-none fixed inset-x-0 top-0 z-40",
    style: {
      background:
        "linear-gradient(180deg, rgba(1,15,22,0.92) 0%, rgba(1,15,22,0.72) 72%, rgba(1,15,22,0) 100%)",
    },
  },
}

/* amanita's `pointer-events-none`/`-auto` pair mirrors BOTTOM_OUTER/INNER's,
 * and for the same reason as AmanitaBackground's: this bar is `fixed`, so it
 * scroll-chains to the (unscrollable) viewport rather than to the page's
 * `overflow-y-auto` scroller, and its full-bleed gradient would otherwise eat
 * the wheel across the whole top strip. `-auto` is put back on the inner
 * element so the pills stay clickable. The default skin's nav is `sticky` — it
 * scrolls with its container, so it never had the problem. */
const NAV_INNER: Record<CheckoutSkin, { className: string }> = {
  default: { className: "flex gap-2 overflow-x-auto px-4 py-3" },
  amanita: {
    className:
      "no-scrollbar pointer-events-auto mx-auto flex max-w-[980px] items-center gap-1.5 overflow-x-auto px-3 py-3 md:justify-center",
  },
}

const PILL: Record<
  CheckoutSkin,
  {
    base: string
    active: string
    inactive: string
    activeStyle?: CSSProperties
    inactiveStyle?: CSSProperties
  }
> = {
  default: {
    base: "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
    active: "border-foreground bg-foreground text-background",
    inactive: "border-border text-muted-foreground hover:text-foreground",
  },
  amanita: {
    base: "flex shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 py-1.5 font-condensed text-xs font-medium uppercase tracking-[0.08em] transition-colors",
    active: "text-sand",
    inactive: "border-white/20 hover:border-mint hover:text-mint",
    activeStyle: {
      backgroundColor: "#0a1424",
      borderColor: "rgba(193,170,136,0.7)",
    },
    inactiveStyle: { color: "rgba(241,235,227,0.78)" },
  },
}

const MAIN_CLASSES: Record<CheckoutSkin, string> = {
  default: "mx-auto w-full max-w-2xl px-4 pb-40 pt-6",
  amanita:
    "relative z-[1] mx-auto w-full max-w-[760px] px-4 pb-48 pt-20 md:pt-24",
}

const BOTTOM_OUTER: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: { className: "fixed inset-x-0 bottom-0 z-40 px-4 pb-4" },
  amanita: {
    className: "pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3",
    style: { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" },
  },
}

/* Surface only — the bar's layout is applied per-branch at the JSX below,
 * because the two branches lay out differently and `display` can't be
 * overridden by a later class in the attribute (the cascade decides, not the
 * order written here). */
const BOTTOM_INNER: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: {
    className:
      "mx-auto max-w-2xl items-center gap-3 rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur",
  },
  amanita: {
    className:
      "pointer-events-auto mx-auto max-w-[760px] items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 md:px-6",
    style: {
      backgroundColor: "rgba(3,22,33,0.93)",
      boxShadow: "0 18px 48px rgba(1,15,22,0.65)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    },
  },
}

const BACK_BUTTON: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: {
    className:
      "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40",
  },
  amanita: {
    className:
      "inline-flex shrink-0 items-center gap-1.5 font-condensed text-xs font-medium uppercase tracking-[0.12em] transition-colors hover:text-cream disabled:opacity-40",
    style: { color: "rgba(241,235,227,0.7)" },
  },
}

const TOTAL_LABEL_CLASSES: Record<CheckoutSkin, string> = {
  default: "text-[10px] uppercase tracking-wider text-muted-foreground",
  amanita:
    "font-condensed text-[0.6rem] font-medium uppercase tracking-[0.24em] text-sand",
}

const TOTAL_VALUE_CLASSES: Record<CheckoutSkin, string> = {
  default: "text-lg font-bold text-foreground",
  amanita: "font-condensed text-lg leading-tight text-cream md:text-xl",
}

/* Intro bottom bar's hint text, shown where the Total sits on other steps.
 * amanita is ported verbatim from the mockup's hero bar
 * (checkout-amanita/codigo/checkout/CheckoutExperience.tsx:350-355). */
const HINT_CLASSES: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: { className: "min-w-0 text-sm text-muted-foreground" },
  amanita: {
    className: "min-w-0 text-sm leading-snug md:text-base",
    style: { color: "rgba(241,235,227,0.85)" },
  },
}

/* amanita is the live reference's recipe
 * (https://amanita-web.vercel.app/checkout-design) — a flat gold fill over
 * the lighter `btn-ornate-2` frame, not the gem-framed `btn-ornate` of the
 * frozen `codigo/` snapshot this skin was originally ported from. The live
 * markup's `focus-visible:ring-accent`/`ring-offset-deep` utilities are
 * dropped: `accent`/`deep` are not Tailwind theme colors in this repo, so
 * those classes would generate nothing (same reason fd4e8945 had to
 * hand-author the `hover:` variants). The ring lives in the skin CSS
 * instead. `disabled:` has no counterpart in the reference — the pay button
 * needs it. */
const CTA_BUTTON_CLASSES: Record<CheckoutSkin, string> = {
  default:
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
  amanita:
    "btn-ornate-2 btn-gold-fill ck-gold flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap !px-4 py-2.5 font-condensed text-xs font-medium uppercase tracking-[0.12em] transition-all duration-200 hover:-translate-y-0.5 md:!px-6 md:text-sm disabled:cursor-not-allowed disabled:opacity-50",
}

/* Bottom-bar direction arrows. `aria-hidden` because the button's own label
 * already names the destination — the arrow is orientation, not information,
 * and announcing it would only add noise to the accessible name the tests and
 * screen readers read. */
const ARROW_CLASSES = "h-3.5 w-3.5 shrink-0"

/** `faqs`-template step's `template_config.items` — same `{question,
 * answer}[]` shape VariantFaqs.tsx parses for the default skin's inline
 * rendering. Defensive parsing since `template_config` is untyped JSON. */
function parseFaqDrawerItems(raw: unknown): FaqDrawerItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const rec = (item ?? {}) as Record<string, unknown>
    return {
      question: typeof rec.question === "string" ? rec.question : "",
      answer: typeof rec.answer === "string" ? rec.answer : "",
    }
  })
}

export default function StepperCheckoutFlow({
  onPaymentComplete,
  navExtraContent,
  brandLogoUrl,
  brandLabel,
}: ScrollyCheckoutFlowProps) {
  const { t } = useTranslation()
  const {
    availableSteps,
    stepConfigs,
    submitPayment,
    isInitialLoading,
    markStepVisited,
    hasAnyCartItems,
    summary,
    isSubmitting,
    termsAccepted,
    isBuyerInfoComplete,
    getBuyerInvalidFields,
    findFirstIncompleteStep,
    markBuyerFieldsTouched,
    triggerCheckoutToast,
    dismissCheckoutToast,
  } = useCheckout()
  const { getCity } = useCityProvider()
  const popup = getCity()
  const skin = resolveCheckoutSkin(popup)
  const isAmanita = skin === "amanita"

  const rawSections = useMemo(
    () => deriveCheckoutSections(availableSteps as string[], stepConfigs),
    [availableSteps, stepConfigs],
  )
  // Amanita: `faqs`-template steps aren't a linear step — they're pulled out
  // of the sequential flow and surfaced via the global FaqsDrawer, opened
  // from a separate "FAQs" pill (mockup pattern). `default` skin keeps them
  // inline, unchanged.
  const faqSections = useMemo(
    () => rawSections.filter((s) => s.template === "faqs"),
    [rawSections],
  )
  const sections = useMemo(
    () =>
      isAmanita
        ? rawSections.filter((s) => s.template !== "faqs")
        : rawSections,
    [rawSections, isAmanita],
  )
  const navSections = useMemo(
    () => sections.filter((s) => s.showInNavbar !== false),
    [sections],
  )
  const faqItems = useMemo(
    () => parseFaqDrawerItems(faqSections[0]?.config?.template_config?.items),
    [faqSections],
  )
  const [faqsOpen, setFaqsOpen] = useState(false)
  const closeFaqs = useCallback(() => setFaqsOpen(false), [])

  const [active, setActive] = useState(0)
  const last = Math.max(0, sections.length - 1)

  // Each step should open at the top. The checkout scrolls inside an
  // overflow container (not the window), so on a step change we reset that
  // scroller rather than leaving the previous step's Y position.
  const rootRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the trigger; the body only reads a ref
  useEffect(() => {
    const scroller = rootRef.current?.closest(".overflow-y-auto")
    if (scroller) scroller.scrollTop = 0
    else window.scrollTo(0, 0)
  }, [active])

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), last)
      const id = sections[clamped]?.id
      if (id) markStepVisited(id)
      setActive(clamped)
    },
    [last, sections, markStepVisited],
  )

  const scrollToStep = useCallback(
    (stepId: string) => {
      const idx = sections.findIndex((s) => s.id === stepId)
      if (idx >= 0) goTo(idx)
    },
    [sections, goTo],
  )

  // Amanita Confirm section's empty-cart CTA ("Ver tickets") — jump to the
  // first product step (i.e. the first section that isn't buyer/confirm).
  const goToFirstProductSection = useCallback(() => {
    const idx = sections.findIndex(
      (s) => s.stepType !== "buyer" && s.stepType !== "confirm",
    )
    goTo(idx >= 0 ? idx : 0)
  }, [sections, goTo])

  // Send the user to a step by its type rather than its id: `sections` ids are
  // disambiguated for repeats (`housing-2`), so an id lookup misses.
  const goToStepType = useCallback(
    (stepType: string) => {
      const idx = sections.findIndex((s) => s.stepType === stepType)
      if (idx >= 0) goTo(idx)
      return idx >= 0
    },
    [sections, goTo],
  )

  // Reveal every unmet field on a gated step and put the caret in the first
  // one. Fields are marked touched through the provider because the user
  // never focused them — without that the inputs stay silently pristine and
  // the bounce looks like the button is simply broken.
  const revealBuyerErrors = useCallback(() => {
    markBuyerFieldsTouched(getBuyerInvalidFields())
    if (typeof document === "undefined") return
    // Deferred so React has painted the errors and the inputs actually carry
    // aria-invalid by the time we look. Searching the whole document is safe
    // here in a way it wouldn't be in the scrolly funnel: the stepper mounts
    // exactly one step, so the only invalid fields on the page are the
    // buyer's.
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus({ preventScroll: true })
    }, 250)
  }, [markBuyerFieldsTouched, getBuyerInvalidFields])

  const handlePayment = useCallback(async () => {
    // Enable-and-validate, mirroring CartFooter's Path A: the button stays
    // pressable and explains the problem, rather than sitting dead with no
    // hint of what is missing. The buyer step can be skipped outright via the
    // nav pills, so this — not the Continue gate — is the load-bearing check.
    const incomplete = findFirstIncompleteStep()
    if (incomplete) {
      if (incomplete === "buyer") revealBuyerErrors()
      goToStepType(incomplete)
      triggerCheckoutToast({
        message: t("checkout.toast_buyer_incomplete_pay"),
        chips: [{ label: t("checkout.step_short.buyer"), stepId: incomplete }],
      })
      return
    }
    dismissCheckoutToast()
    const result = await submitPayment()
    if (result.success) onPaymentComplete?.()
  }, [
    submitPayment,
    onPaymentComplete,
    findFirstIncompleteStep,
    revealBuyerErrors,
    goToStepType,
    triggerCheckoutToast,
    dismissCheckoutToast,
    t,
  ])

  // Continue from the buyer step: don't let the user walk forward leaving an
  // invalid form behind them.
  const handleAdvance = useCallback(
    (nextIndex: number) => {
      if (sections[active]?.stepType === "buyer" && !isBuyerInfoComplete) {
        revealBuyerErrors()
        triggerCheckoutToast({
          message: t("checkout.toast_buyer_incomplete_continue"),
        })
        return
      }
      goTo(nextIndex)
    },
    [
      sections,
      active,
      isBuyerInfoComplete,
      revealBuyerErrors,
      triggerCheckoutToast,
      goTo,
      t,
    ],
  )

  if (isInitialLoading) return <Loader />

  const current = sections[active]
  const isLast = active === last
  const nextSection = !isLast ? sections[active + 1] : undefined
  // The service fee only shows from the confirm step on, so earlier steps read
  // as a products-only "Subtotal" with the fee neither shown nor folded into
  // the bar's headline number.
  const isConfirmStep = current?.stepType === "confirm"
  const deferServiceFee = !isConfirmStep && summary.contributionSubtotal > 0
  const footerTotal = deferServiceFee
    ? summary.grandTotal - summary.contributionSubtotal
    : summary.grandTotal
  // Both of these read the cart through the provider rather than re-deriving
  // it from `cart.*`: an open checkout routes ticket picks to
  // `cart.dynamicItems`, never `cart.passes` (useTicketsStep.ts:284,336), so
  // any hand-rolled `passes`-based count is empty exactly when the shopper has
  // a full cart. `summary.itemCount` and `hasAnyCartItems` already span every
  // cart bucket — CartFooter reads the same two.
  const itemCount = summary.itemCount
  const requiresTerms = !!popup?.terms_and_conditions_url && !termsAccepted
  const canPay = hasAnyCartItems && !requiresTerms && !isSubmitting
  // Derived once and handed to Amanita's in-card CTA below, for the same
  // reason `handlePayment`/`canPay` are: the two buttons pay for the same
  // order, so they must say the same thing. Re-deriving this next to the card
  // is what let it read "Confirmar compra" while the bar read "Pagar".
  //
  // The organizer can name this button on the confirm step, and what they wrote
  // wins — including on a free order, since `cta_label` is authored for this
  // button specifically and second-guessing it would just make the field lie.
  // It's read from the *confirm* step's config rather than `current`'s: the bar
  // renders the pay CTA on the last step, which is where this label belongs,
  // and the in-card CTA needs the same string regardless of which step is
  // active. Reuses the hero's `cta_label` key, which the translation overlay
  // already treats as copy (backend service.py `_TEXT_LEAF_KEYS`), so the
  // string arrives here already in the shopper's language.
  const confirmTemplateConfig = (sections.find(
    (section) => section.stepType === "confirm",
  )?.config?.template_config ?? {}) as { cta_label?: string }
  const authoredPayLabel = confirmTemplateConfig.cta_label?.trim()
  const payLabel =
    authoredPayLabel ||
    (summary.grandTotal === 0
      ? t("checkout.actions.claim_pass")
      : t("checkout.actions.pay"))

  // The first section is an "intro" when it's a content-only template (a hero
  // or similar): nothing has been priced yet, so the bar drops Back and Total
  // and invites the user forward instead. Gated on the template — not on
  // `active === 0` — so popups that open straight into a product step keep
  // their standard bar.
  const currentTemplate = current?.config?.template
  const isCurrentContentOnly =
    !!currentTemplate && CONTENT_ONLY_TEMPLATES.has(currentTemplate)
  const isIntro = !isLast && active === 0 && isCurrentContentOnly
  // Amanita's own renderers (catalog/buyer/confirm) each wrap their content in
  // SectionShell, which already draws the step's title and description in the
  // skin's design — the generic header above them duplicates both, in the
  // default theme's colors. Content-only templates render bare variants with
  // no SectionShell, so they keep it or they'd have no title at all.
  const contentOwnsHeader = isAmanita && !isCurrentContentOnly
  const introConfig = (current?.config?.template_config ?? {}) as {
    cta_label?: string
    cta_hint?: string
  }
  // The active step's raw config, for the trailing FAQs/footnotes blocks.
  const currentTemplateConfig = current?.config?.template_config as
    | Record<string, unknown>
    | null
    | undefined

  const renderStepContent = (section: (typeof sections)[number]) => {
    const { stepType, config } = section
    const isFirstSection = active === 0
    if (stepType === "buyer")
      return isAmanita ? (
        /* `contentOwnsHeader` suppresses the generic SectionHeader on this
           skin, so the step's configured title/description/watermark only
           reach the screen if its own shell is given the config. */
        <AmanitaBuyerStep stepConfig={config} />
      ) : (
        <OpenCheckoutBuyerStep />
      )
    if (stepType === "confirm")
      return isAmanita ? (
        /* The card's CTA is a second trigger for the same payment as the
           bottom bar's, so it is handed the bar's own handler, gate and
           label rather than re-deriving them: `canPay` already folds in
           `!isSubmitting`, which is what stops a double charge once one of
           the two has been pressed. Two buttons, one source of truth. */
        <AmanitaConfirmSection
          stepConfig={config}
          onGoToTickets={goToFirstProductSection}
          onPay={handlePayment}
          payDisabled={!canPay}
          payLabel={payLabel}
        />
      ) : (
        <ConfirmStep />
      )
    // Amanita: route product steps (passes/tickets, or any other
    // config-carrying step) to the pixel-perfect catalog card layout.
    // Content-only templates are excluded: they have no products to
    // catalog and keep rendering via DynamicProductStep below for both
    // skins. (`faqs` steps never reach here for Amanita anyway — they're
    // filtered out of `sections` above and surfaced via the FAQs drawer.)
    const isContentOnlyTemplate =
      !!config?.template && CONTENT_ONLY_TEMPLATES.has(config.template)
    const isProductStep =
      (stepType === "passes" || stepType === "tickets" || !!config) &&
      !isContentOnlyTemplate
    if (isProductStep && isAmanita && config) {
      return <AmanitaCatalogSection stepConfig={config} />
    }
    if (stepType === "passes" || stepType === "tickets") {
      if (shouldUseDynamicStep(config ?? undefined)) {
        return (
          <DynamicProductStep
            stepConfig={config!}
            onSkip={() => {}}
            isFirstSection={isFirstSection}
          />
        )
      }
      return <PassSelectionSection />
    }
    if (config) {
      return (
        <DynamicProductStep
          stepConfig={config}
          onSkip={() => {}}
          isFirstSection={isFirstSection}
        />
      )
    }
    return null
  }

  return (
    <div ref={rootRef} className={ROOT_CLASSES[skin]}>
      {isAmanita && <AmanitaBackground />}

      {/* pills nav */}
      {/* `pr-14` below `lg` insets the <nav>'s scroll viewport so the pinned
          switcher gets a gutter of its own — padding *inside* the scroller
          would only hold the pills back at the end of their travel, letting
          them slide under it mid-scroll. The gutter must clear the switcher's
          own width plus its `right-2` offset, so it is wider than it looks.
          Above `lg` the centred rail can no longer reach the switcher, so the
          gutter is dropped and the pills centre against the true viewport. The
          bar's background is painted behind this padding, so it stays
          full-bleed either way. */}
      <header
        className={`${NAV_OUTER[skin].className} pr-14 lg:pr-0`}
        style={NAV_OUTER[skin].style}
      >
        <nav
          aria-label="Checkout sections"
          className={NAV_INNER[skin].className}
        >
          {navSections.map((section, navIdx) => {
            const idx = sections.findIndex((s) => s.id === section.id)
            const isActive = idx === active
            const pill = PILL[skin]
            // Amanita mockup detail (Task 5 review, folded in here): the first
            // pill shows the brand mark instead of a text label, and the
            // Confirm pill carries a cart-count badge once items are added.
            const isFirstPill = isAmanita && navIdx === 0
            const showCartBadge =
              isAmanita && section.stepType === "confirm" && itemCount > 0
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => goTo(idx)}
                aria-current={isActive ? "step" : undefined}
                className={`${pill.base} ${isActive ? pill.active : pill.inactive}`}
                style={isActive ? pill.activeStyle : pill.inactiveStyle}
              >
                {isFirstPill ? (
                  <>
                    <Image
                      src="/checkout-skins/amanita/logo-hongo.webp"
                      alt=""
                      aria-hidden
                      width={647}
                      height={360}
                      className="h-4 w-auto"
                    />
                    <span className="sr-only">
                      {t("checkout.amanita.nav_home_sr")}
                    </span>
                  </>
                ) : (
                  section.label
                )}
                {showCartBadge && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sand px-1 font-condensed text-[0.6rem] font-semibold text-deep">
                    {itemCount}
                  </span>
                )}
              </button>
            )
          })}
          {isAmanita && faqSections.length > 0 && (
            <>
              <span
                aria-hidden
                className="mx-1 h-4 w-px shrink-0 bg-white/25"
              />
              <button
                type="button"
                onClick={() => setFaqsOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={faqsOpen}
                className="shrink-0 whitespace-nowrap rounded-full border border-dashed bg-transparent px-3.5 py-1.5 font-condensed text-xs font-medium uppercase tracking-[0.08em] transition-colors hover:border-mint hover:text-mint"
                style={{
                  borderColor: "rgba(241,235,227,0.4)",
                  color: "rgba(241,235,227,0.85)",
                }}
              >
                {t("checkout.amanita.faqs_pill_label")}
              </button>
            </>
          )}
        </nav>
        {/* Pinned to the bar's right edge instead of trailing the pills: the
            pills are a centred rail, and the switcher is a page-level control
            that shouldn't read as one more step. The bar is already
            fixed/sticky, so it is the containing block — adding `relative`
            here would re-declare `position` and drop the bar out of flow. */}
        {/* `pointer-events-auto` for the same reason the <nav> above has it:
            amanita's bar is `pointer-events-none` so the wheel reaches the
            page scroller through it, and this control sits outside the <nav>,
            so it has to opt back in on its own or it can't be clicked. */}
        {navExtraContent && (
          <div className="pointer-events-auto absolute inset-y-0 right-2 flex items-center">
            {navExtraContent}
          </div>
        )}
      </header>

      {isAmanita && (
        <FaqsDrawer open={faqsOpen} items={faqItems} onClose={closeFaqs} />
      )}

      <CheckoutToast onChipClick={scrollToStep} />

      {/* one section at a time */}
      <main className={MAIN_CLASSES[skin]}>
        {/* Amanita already carries its brand mark in the nav's "home" pill, and
            its hero opens on the wordmark artwork — a second copy of the logo
            above every step is not part of that skin. */}
        {brandLogoUrl && !isAmanita && (
          <Image
            src={brandLogoUrl}
            alt={brandLabel ?? ""}
            width={40}
            height={40}
            className="mx-auto mb-4 h-10 w-auto"
            {...imageOptimization(brandLogoUrl)}
          />
        )}
        {current && (
          <>
            {!contentOwnsHeader && (
              <div className="mb-8">
                <SectionHeader
                  title={current.config?.title ?? current.label}
                  subtitle={current.config?.description ?? undefined}
                  variant="snap"
                  watermark={current.config?.watermark ?? current.label}
                  showTitle={current.config?.show_title ?? true}
                  showWatermark={current.config?.show_watermark ?? true}
                />
              </div>
            )}
            {renderStepContent(current)}
            {/* A step's own FAQs, below its content (the mockup's "Preguntas
                sobre el acampe" under the Alojamiento cards). Rendered here
                rather than inside AmanitaCatalogSection because the backoffice
                offers the field on every step — buyer and confirm included —
                and the catalog only covers the product ones. */}
            {isAmanita && (
              <AmanitaStepFaqs templateConfig={currentTemplateConfig} />
            )}
            {/* Last on the step, under the FAQs — the mockup's centred
                clarifications below the Extras cards. */}
            <StepFootnotes skin={skin} templateConfig={currentTemplateConfig} />
          </>
        )}
      </main>

      {/* fixed bottom bar: Back / Total / contextual CTA */}
      <div
        className={BOTTOM_OUTER[skin].className}
        style={BOTTOM_OUTER[skin].style}
      >
        {/* Three equal-weight slots, so Total sits on the bar's true centre.
            `justify-between` can't: it centres Total in the space LEFT OVER
            between Back and the CTA, so the wider CTA drags it off-centre by
            half the width difference. The intro bar is a different shape — a
            hint and a CTA, no centre slot — and keeps flex. */}
        <div
          className={`${BOTTOM_INNER[skin].className} ${
            isIntro ? "flex justify-between" : "grid grid-cols-[1fr_auto_1fr]"
          }`}
          style={BOTTOM_INNER[skin].style}
        >
          {isIntro ? (
            <>
              <p
                className={HINT_CLASSES[skin].className}
                style={HINT_CLASSES[skin].style}
              >
                {introConfig.cta_hint ?? ""}
              </p>
              <button
                type="button"
                data-testid="stepper-next"
                onClick={() => handleAdvance(active + 1)}
                className={CTA_BUTTON_CLASSES[skin]}
              >
                {introConfig.cta_label || nextSection?.label}
                <ArrowRight aria-hidden className={ARROW_CLASSES} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => goTo(active - 1)}
                disabled={active === 0}
                className={`${BACK_BUTTON[skin].className} justify-self-start`}
                style={BACK_BUTTON[skin].style}
              >
                <ArrowLeft aria-hidden className={ARROW_CLASSES} />
                {t("common.back")}
              </button>
              <div className="flex min-w-0 flex-col items-center">
                <span className={TOTAL_LABEL_CLASSES[skin]}>
                  {deferServiceFee
                    ? t("openCheckout.summary_subtotal")
                    : t("common.total")}
                </span>
                <span className={TOTAL_VALUE_CLASSES[skin]}>
                  {formatCurrency(footerTotal)}
                </span>
              </div>
              {isLast ? (
                <button
                  type="button"
                  data-testid="stepper-next"
                  onClick={handlePayment}
                  disabled={!canPay}
                  className={`${CTA_BUTTON_CLASSES[skin]} justify-self-end`}
                >
                  {payLabel}
                  <ArrowRight aria-hidden className={ARROW_CLASSES} />
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="stepper-next"
                  onClick={() => handleAdvance(active + 1)}
                  className={`${CTA_BUTTON_CLASSES[skin]} justify-self-end`}
                >
                  {nextSection?.label}
                  <ArrowRight aria-hidden className={ARROW_CLASSES} />
                </button>
              )}
            </>
          )}
          {itemCount > 0 && (
            <span className="sr-only">{itemCount} items in cart</span>
          )}
        </div>
      </div>
    </div>
  )
}
