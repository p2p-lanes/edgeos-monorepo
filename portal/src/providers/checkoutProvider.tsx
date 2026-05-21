"use client"

import { useQuery } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import {
  CHECKOUT_MODE,
  resolvePopupCheckoutPolicy,
} from "@/checkout/popupCheckoutPolicy"
import type { TicketingStepPublic } from "@/client"
import { TicketingStepsService } from "@/client"
import { CONTENT_ONLY_TEMPLATES } from "@/components/checkout-flow/registries/variantRegistry"
import { supportsQuantitySelector } from "@/components/ui/QuantitySelector"
import type { StepProductResolution } from "@/hooks/checkout"
import {
  type CartSelectionState,
  useCartPersistence,
  useCartSummary,
  useCheckoutSteps,
  useCreditCalculation,
  useHousingSelection,
  useInsuranceCalculation,
  useMealPlanSelection,
  useMerchSelection,
  usePatronSelection,
  usePaymentSubmit,
  usePromoCode,
} from "@/hooks/checkout"
import { useStepProductResolver } from "@/hooks/checkout/useStepProductResolver"
import useGetPassesData from "@/hooks/useGetPassesData"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { buildFormZodSchema } from "@/lib/form-schema-builder"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutCartState,
  CheckoutCartSummary,
  CheckoutStep,
  SelectedDynamicItem,
  SelectedPassItem,
} from "@/types/checkout"
import type { ApplicationFormSchema } from "@/types/form-schema"
import type { ProductsPass } from "@/types/Products"
import { useApplication } from "./applicationProvider"
import { useCityProvider } from "./cityProvider"
import { useDiscount } from "./discountProvider"
import { usePassesProvider } from "./passesProvider"

interface CheckoutContextValue {
  currentStep: CheckoutStep
  availableSteps: CheckoutStep[]
  stepConfigs: TicketingStepPublic[]
  cart: CheckoutCartState
  summary: CheckoutCartSummary
  allProducts: ProductsPass[]
  productsByStepId: Map<string, ProductsPass[]>
  getProductsForStep: StepProductResolution["getProductsForStep"]
  attendees: AttendeePassState[]
  isLoading: boolean
  isInitialLoading: boolean
  isSubmitting: boolean
  error: string | null
  goToStep: (step: CheckoutStep) => void
  goToNextStep: () => void
  goToPreviousStep: () => void
  togglePass: (
    attendeeId: string,
    productId: string,
    quantityOverride?: number,
  ) => void
  resetDayProduct: (attendeeId: string, productId: string) => void
  selectHousing: (productId: string, checkIn: string, checkOut: string) => void
  updateHousingQuantity: (quantity: number) => void
  clearHousing: () => void
  updateMerchQuantity: (productId: string, quantity: number) => void
  setPatronAmount: (
    productId: string,
    amount: number,
    isCustom?: boolean,
  ) => void
  clearPatron: () => void
  /** Add a meal-plan cart entry for (attendee, weekly product). `weekdayDates`
   *  are the Mon–Fri ISO dates derived by the variant from the step's
   *  template_config coverage range. The reducer seeds dailyChoices to
   *  {date: "chef"} for every weekday. */
  addMealPlan: (
    attendeeId: string,
    productId: string,
    weekdayDates: string[],
  ) => void
  removeMealPlan: (attendeeId: string, productId: string) => void
  setMealPlanDailyChoice: (
    attendeeId: string,
    productId: string,
    date: string,
    menuKey: string,
  ) => void
  /** Per-attendee field — synced across every meal-plan entry for the attendee. */
  setMealPlanDietaryRestriction: (attendeeId: string, value: string) => void
  /** Per-attendee field — synced across every meal-plan entry for the attendee. */
  setMealPlanSpecialRequest: (attendeeId: string, value: string) => void
  applyPromoCode: (code: string) => Promise<boolean>
  clearPromoCode: () => void
  toggleInsurance: () => void
  clearCart: () => void
  canProceedToStep: (step: CheckoutStep) => boolean
  isStepComplete: (step: CheckoutStep) => boolean
  submitPayment: () => Promise<{ success: boolean; error?: string }>
  isEditing: boolean
  toggleEditing: (editing?: boolean) => void
  editCredit: number
  monthUpgradeCredit: number
  termsAccepted: boolean
  setTermsAccepted: (accepted: boolean) => void
  addDynamicItem: (stepType: string, item: SelectedDynamicItem) => void
  removeDynamicItem: (stepType: string, productId: string) => void
  updateDynamicQuantity: (
    stepType: string,
    productId: string,
    qty: number,
  ) => void
  buyerFormSchema: ApplicationFormSchema | null
  buyerValues: Record<string, unknown>
  buyerErrors: Record<string, string>
  buyerGeneralError: string | null
  setBuyerField: (fieldName: string, value: unknown) => void
  isBuyerInfoComplete: boolean
  /** Names of buyer-form fields that fail the current Zod schema. Empty
   *  when the form is complete or no schema is configured. Source of
   *  truth for "where did the user miss something?" — the CartFooter's
   *  enable-and-validate flow uses it to mark fields touched and
   *  decide which step to scroll back to. */
  getBuyerInvalidFields: () => string[]
  /** Returns the step_type of the first step (in funnel order) with
   *  unmet required input. Today only buyer is gated; returns `null`
   *  when nothing's missing. */
  findFirstIncompleteStep: () => string | null
  /** Returns the step_type of the first product-bearing step the user
   *  should be sent to when the cart is empty. Prefers visited steps,
   *  else falls back to the first product step in funnel order. */
  findFirstProductStep: (visited?: Set<string>) => string | null
  /** True when at least one cartable item is present (regardless of price). */
  hasAnyCartItems: boolean
  /** Step types the user has scrolled into during this session. Updated
   *  by the funnel's IntersectionObserver. Used by the nav to paint a
   *  step amber (visited but incomplete) vs leave it neutral. */
  visitedSteps: Set<string>
  markStepVisited: (stepType: string) => void
  /** Buyer-form fields that should render their error regardless of
   *  whether the user has actually focused them. Triggered when the
   *  user presses Continuar/Pagar with incomplete data; cleared when
   *  the user edits again. */
  forcedBuyerFieldsTouched: Set<string>
  markBuyerFieldsTouched: (fieldNames: string[]) => void
  clearForcedBuyerFieldsTouched: () => void
  /** Persistent banner the funnel raises when a Continuar/Pagar attempt
   *  fails validation. Persistent until dismissed so the user doesn't
   *  lose context mid-correction. */
  checkoutToast: CheckoutToastState | null
  triggerCheckoutToast: (state: Omit<CheckoutToastState, "id">) => void
  dismissCheckoutToast: () => void
  cartUiEnabled: boolean
  creditsEnabled: boolean
}

export interface CheckoutToastChip {
  label: string
  stepId: string
}

export interface CheckoutToastState {
  id: string
  message: string
  chips?: CheckoutToastChip[]
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null)

interface CheckoutProviderProps {
  children: ReactNode
  initialStep?: CheckoutStep
  productsOverride?: ProductsPass[]
  configuredStepsOverride?: TicketingStepPublic[]
  accountCreditOverride?: number
  validatePromoCodeOverride?: (code: string) => Promise<number | null>
  submitMode?: "application" | "open-ticketing"
  submitPopupSlug?: string | null
  buyerFormSchema?: ApplicationFormSchema | null
  initialBuyerValues?: Record<string, unknown>
  cartPersistenceEnabled?: boolean
  cartUiEnabled?: boolean
}

export function CheckoutProvider({
  children,
  initialStep = "passes",
  productsOverride,
  configuredStepsOverride,
  accountCreditOverride,
  validatePromoCodeOverride,
  submitMode = "application",
  submitPopupSlug = null,
  buyerFormSchema = null,
  initialBuyerValues = {},
  cartPersistenceEnabled = true,
  cartUiEnabled = true,
}: CheckoutProviderProps) {
  const { t } = useTranslation()
  const {
    attendeePasses,
    toggleProduct,
    isEditing,
    toggleEditing,
    clearSelections,
  } = usePassesProvider()
  const { discountApplied, setDiscount, resetDiscount } = useDiscount()
  const { getRelevantApplication } = useApplication()
  const { getCity } = useCityProvider()
  const { products: queriedProducts, loading: isLoadingProducts } =
    useGetPassesData()
  const products = productsOverride ?? queriedProducts
  const isAuthenticated = useIsAuthenticated()
  const application = getRelevantApplication()
  const city = getCity()
  const creditsEnabled = city?.credits_enabled ?? false
  const appCredit = creditsEnabled
    ? (accountCreditOverride ?? application?.credit)
    : 0
  const checkoutPolicy = resolvePopupCheckoutPolicy(city)
  const cityId = city?.id ? String(city.id) : null

  const hasRestoredCheckoutRef = useRef(false)
  const previousCityIdRef = useRef(cityId)
  const paymentCompleteRef = useRef(false)
  const [buyerValues, setBuyerValues] =
    useState<Record<string, unknown>>(initialBuyerValues)
  const [buyerErrors, setBuyerErrors] = useState<Record<string, string>>({})
  const [buyerGeneralError, setBuyerGeneralError] = useState<string | null>(
    null,
  )

  // Ticketing step configuration from API
  const { data: stepsData, isLoading: isLoadingSteps } = useQuery({
    queryKey: ["ticketing-steps-portal", cityId],
    queryFn: () =>
      TicketingStepsService.listPortalTicketingSteps({
        popupId: cityId!,
      }),
    enabled: !configuredStepsOverride && !!cityId && isAuthenticated,
  })
  const configuredSteps = configuredStepsOverride ?? stepsData?.results ?? []
  const effectiveConfiguredSteps = useMemo(() => {
    if (!buyerFormSchema || submitMode !== "open-ticketing") {
      return configuredSteps
    }

    // Post-migration, every direct-sale popup carries a real `buyer` row whose
    // position the admin controls from the backoffice — use it as-is.
    if (configuredSteps.some((step) => step.step_type === "buyer")) {
      return configuredSteps
    }

    // Legacy fallback: popup hasn't been migrated yet. Synthesize a buyer
    // step and slot it just before confirm so checkout still works.
    const confirmStep = configuredSteps.find(
      (step) => step.step_type === "confirm",
    )

    const buyerStep: TicketingStepPublic = {
      id: "buyer-step",
      tenant_id: cityId ?? "",
      popup_id: cityId ?? "",
      step_type: "buyer",
      title: t("checkout.buyer_step_title"),
      description: t("checkout.buyer_step_description"),
      order: 9998,
      is_enabled: true,
      protected: true,
      product_category: null,
      template: null,
      template_config: null,
      watermark: null,
      show_title: confirmStep?.show_title ?? true,
      show_watermark: confirmStep?.show_watermark ?? true,
    }

    const confirmIndex = configuredSteps.findIndex(
      (step) => step.step_type === "confirm",
    )

    if (confirmIndex === -1) {
      return [...configuredSteps, buyerStep]
    }

    return [
      ...configuredSteps.slice(0, confirmIndex),
      buyerStep,
      ...configuredSteps.slice(confirmIndex),
    ]
  }, [buyerFormSchema, cityId, configuredSteps, submitMode, t])

  const isBuyerInfoComplete =
    !buyerFormSchema ||
    buildFormZodSchema(buyerFormSchema, false).safeParse(buyerValues).success

  // Returns the names of buyer-form fields that fail the current schema.
  // Returns [] when complete or when no schema is configured.
  const getBuyerInvalidFields = useCallback((): string[] => {
    if (!buyerFormSchema) return []
    const result = buildFormZodSchema(buyerFormSchema, false).safeParse(
      buyerValues,
    )
    if (result.success) return []
    const seen = new Set<string>()
    for (const issue of result.error.issues) {
      const fieldName =
        Array.isArray(issue.path) && issue.path.length > 0
          ? String(issue.path[0])
          : null
      if (fieldName) seen.add(fieldName)
    }
    return Array.from(seen)
  }, [buyerFormSchema, buyerValues])

  // True while step configs or products are still loading on first render.
  // Why: when both queries are pending, availableSteps falls back to
  // ["passes", "confirm"] with default labels and the cart total reads $0,
  // producing a brief flash of a "broken" checkout before real data arrives.
  const isInitialLoading =
    !!cityId && isAuthenticated && (isLoadingSteps || isLoadingProducts)

  // Step-aware product resolution (replaces hardcoded useProductCategories).
  // Each step's product list is derived from step.product_category at runtime,
  // not from a hardcoded "merch"/"housing"/"patreon" filter on the full list.
  const { productsByStepId, getProductsForStep } = useStepProductResolver(
    effectiveConfiguredSteps,
    products,
  )

  // Full active product list — passed to cart selection hooks so id-lookup works
  // regardless of the product's category string. The hooks do their own
  // `find(p => p.id === productId)` after the click; the array must not be
  // pre-filtered by category here.
  const allActiveProducts = useMemo(
    () => products.filter((p) => p.is_active),
    [products],
  )

  // Item selection hooks
  const housingPricePerDay = useMemo(() => {
    const step = configuredSteps.find((s) => s.step_type === "housing")
    if (!step?.template_config) return true
    const cfg = step.template_config as Record<string, unknown>
    // When the housing step hides the date picker, the per-night multiplication
    // is meaningless — force flat pricing so totals use product.price directly.
    if (cfg.show_dates === false) return false
    return cfg.price_per_day !== false
  }, [configuredSteps])

  const {
    housing,
    setHousing,
    selectHousing,
    updateHousingQuantity,
    clearHousing,
  } = useHousingSelection(allActiveProducts, housingPricePerDay)

  const { merch, setMerch, updateMerchQuantity } =
    useMerchSelection(allActiveProducts)

  const { patron, setPatron, setPatronAmount, clearPatron } =
    usePatronSelection(allActiveProducts)

  const {
    mealPlans: selectedMealPlans,
    setMealPlans: setSelectedMealPlans,
    addMealPlan,
    removeMealPlan,
    setMealPlanDailyChoice,
    setMealPlanDietaryRestriction,
    setMealPlanSpecialRequest,
  } = useMealPlanSelection(allActiveProducts)

  const [insurance, setInsurance] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [dynamicItems, setDynamicItems] = useState<
    Record<string, SelectedDynamicItem[]>
  >({})
  // Steps the user has scrolled into during this session. Session-only —
  // no localStorage. Used purely for nav UX (paint amber when started
  // but not completed).
  const [visitedSteps, setVisitedSteps] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const markStepVisited = useCallback((stepType: string) => {
    setVisitedSteps((prev) => {
      if (prev.has(stepType)) return prev
      const next = new Set(prev)
      next.add(stepType)
      return next
    })
  }, [])
  const [forcedBuyerFieldsTouched, setForcedBuyerFieldsTouched] = useState<
    Set<string>
  >(() => new Set<string>())
  const markBuyerFieldsTouched = useCallback((fieldNames: string[]) => {
    if (fieldNames.length === 0) return
    setForcedBuyerFieldsTouched((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const name of fieldNames) {
        if (!next.has(name)) {
          next.add(name)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])
  const clearForcedBuyerFieldsTouched = useCallback(() => {
    setForcedBuyerFieldsTouched((prev) =>
      prev.size === 0 ? prev : new Set<string>(),
    )
  }, [])
  const [checkoutToast, setCheckoutToast] = useState<CheckoutToastState | null>(
    null,
  )
  const triggerCheckoutToast = useCallback(
    (state: Omit<CheckoutToastState, "id">) => {
      // Fresh id forces re-render even when the same message fires twice
      // (e.g. user re-clicks Pay with the same missing data); useful for
      // chip animations downstream.
      setCheckoutToast({ ...state, id: String(Date.now()) })
    },
    [],
  )
  const dismissCheckoutToast = useCallback(() => {
    setCheckoutToast(null)
  }, [])

  // Build selected passes from attendeePasses
  const selectedPasses = useMemo<SelectedPassItem[]>(() => {
    const passes: SelectedPassItem[] = []

    for (const attendee of attendeePasses) {
      for (const product of attendee.products) {
        if (product.selected && !(isEditing && product.purchased)) {
          const isDayPass = product.duration_type === "day"
          const quantity =
            checkoutPolicy.checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY
              ? supportsQuantitySelector(product.max_per_order) || isDayPass
                ? (product.quantity ?? 1)
                : 1
              : isDayPass
                ? (product.quantity ?? 1) - (product.original_quantity ?? 0)
                : supportsQuantitySelector(product.max_per_order)
                  ? (product.quantity ?? 1)
                  : 1

          if (quantity > 0) {
            passes.push({
              productId: product.id,
              product,
              attendeeId: attendee.id,
              attendee,
              quantity,
              price: product.price * quantity,
              originalPrice: product.original_price
                ? product.original_price * quantity
                : undefined,
            })
          }
        }
      }
    }

    return passes
  }, [attendeePasses, checkoutPolicy.checkoutMode, isEditing])

  // Ref that holds the latest selection state for cart persistence.
  // Initialized with defaults — updated to real values after all hooks run.
  const selectionStateRef = useRef<CartSelectionState>({
    selectedPasses,
    housing,
    merch,
    patron,
    selectedMealPlans,
    promoCode: "",
    promoCodeValid: false,
    insurance,
    currentStep: initialStep,
  })

  // Cart persistence hook (replaces debounced save + restoration effects)
  const {
    savedCart,
    saveCart,
    scheduleSave,
    clearCart: clearPersistedCart,
  } = useCartPersistence({
    enabled: cartPersistenceEnabled,
    cityId,
    initialStep,
    products,
    housingPricePerDay,
    selectionStateRef,
    restorationSetters: {
      setHousing,
      setMerch,
      setPatron,
      setMealPlans: setSelectedMealPlans,
      setInsurance,
    },
    hasRestoredCheckoutRef,
    paymentCompleteRef,
  })

  // Promo code hook
  const {
    promoCode,
    promoCodeValid,
    promoCodeDiscount,
    setPromoCode,
    setPromoCodeValid,
    setPromoCodeDiscount,
    applyPromoCode,
    clearPromoCode,
    promoIsLoading,
    promoError,
    setPromoError,
  } = usePromoCode({
    cityId: city?.id,
    discountAppliedValue: discountApplied.discount_value,
    setDiscount,
    resetDiscount,
    savedCart,
    hasRestoredCheckoutRef,
    validatePromoCodeOverride,
  })

  // Step management
  const {
    currentStep,
    setCurrentStep,
    availableSteps,
    goToStep: goToStepRaw,
    goToNextStep: goToNextStepRaw,
    goToPreviousStep: goToPreviousStepRaw,
    canProceedToStep: canProceedToStepFn,
    isStepComplete: isStepCompleteFn,
  } = useCheckoutSteps({
    initialStep,
    configuredSteps: effectiveConfiguredSteps,
    productsByStepId,
    selectedPassesCount: selectedPasses.length,
    dynamicItemsCount: Object.values(dynamicItems).flat().length,
    isEditing,
    buyerInfoComplete: isBuyerInfoComplete,
  })

  // Keep selection state ref in sync — promoCode, promoCodeValid, currentStep
  // are defined after useCartPersistence, so we update the ref each render.
  selectionStateRef.current = {
    selectedPasses,
    housing,
    merch,
    patron,
    selectedMealPlans,
    promoCode,
    promoCodeValid,
    insurance,
    currentStep,
  }

  // Auto-save cart selections (debounced). currentStep is excluded — goToStep
  // saves immediately. scheduleSave self-guards against pre-restoration and
  // post-payment states.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps drive the save; scheduleSave reads via ref
  useEffect(() => {
    scheduleSave()
  }, [
    selectedPasses,
    housing,
    merch,
    patron,
    selectedMealPlans,
    promoCode,
    promoCodeValid,
    insurance,
    scheduleSave,
  ])

  // Credit calculations — gated by popup.credits_enabled
  const { editCredit, monthUpgradeCredit } = useCreditCalculation({
    attendeePasses,
    isEditing,
    creditsEnabled,
  })

  // Insurance calculations
  const { insurancePotentialAmount, insuranceAmount } = useInsuranceCalculation(
    {
      popup: city,
      selectedPasses,
      housing,
      merch,
      insurance,
    },
  )

  // Contribution fee — derived from popup config (mandatory when enabled).
  // The popup is the single source of truth for the rate; there is no buyer
  // opt-in toggle. We calculate client-side from popup.contribution_percentage
  // so the summary line renders before submit (transparency requirement).
  const contributionAmount = useMemo<number>(() => {
    if (!city?.contribution_enabled) return 0
    const pct = Number(city.contribution_percentage)
    if (Number.isNaN(pct) || pct <= 0) return 0
    // Pre-fee subtotal: passes + housing + merch + patron (mirrors backend
    // _apply_discounts snapshot: post-discount, before insurance and contribution)
    const passesSubtotal = selectedPasses.reduce(
      (sum, p) => sum + (p.originalPrice ?? p.price),
      0,
    )
    const housingTotal = housing?.totalPrice ?? 0
    const merchTotal = merch.reduce((sum, m) => sum + m.totalPrice, 0)
    const patronTotal = patron?.amount ?? 0
    const preFeeSubtotal =
      passesSubtotal + housingTotal + merchTotal + patronTotal
    return Math.round(((preFeeSubtotal * pct) / 100) * 100) / 100
  }, [city, selectedPasses, housing, merch, patron])

  // Defence-in-depth: take the highest discount available so the total reflects
  // it even if one of the state vectors lags (DiscountProvider's <= guard
  // rejecting an update, or usePromoCode's re-validation effect clobbering
  // promoCodeDiscount with 0 from a stale saved-cart response).
  const effectiveDiscount = Math.max(
    discountApplied.discount_value ?? 0,
    promoCodeDiscount ?? 0,
  )

  // Cart summary
  const { summary } = useCartSummary({
    selectedPasses,
    housing,
    merch,
    patron,
    mealPlans: selectedMealPlans,
    insuranceAmount,
    contributionAmount,
    isEditing,
    editCredit,
    monthUpgradeCredit,
    appCredit,
    discountValue: effectiveDiscount,
  })

  // Reset state when city changes so we re-restore from new city's cart
  useEffect(() => {
    if (previousCityIdRef.current === cityId) return
    previousCityIdRef.current = cityId

    hasRestoredCheckoutRef.current = false
    setHousing(null)
    setMerch([])
    setPatron(null)
    setSelectedMealPlans([])
    setPromoCode("")
    setPromoCodeValid(false)
    setPromoCodeDiscount(0)
    setInsurance(false)
    setCurrentStep("passes")
  }, [
    cityId,
    setCurrentStep,
    setHousing,
    setMerch,
    setPatron,
    setSelectedMealPlans,
    setPromoCode,
    setPromoCodeValid,
    setPromoCodeDiscount,
  ])

  // Loading states
  const isLoading = promoIsLoading
  const error = promoError

  // Restore current step from saved cart (after availableSteps is ready).
  // Uses a ref to capture the initial cart step — ignores subsequent saveCart() updates
  // that would otherwise revert user navigation.
  const hasRestoredStepRef = useRef(false)
  const initialCartStepRef = useRef<string | null | undefined>(undefined)

  // Capture the initial cart step exactly once when cart data first loads
  if (
    initialCartStepRef.current === undefined &&
    hasRestoredCheckoutRef.current &&
    savedCart
  ) {
    initialCartStepRef.current = savedCart.current_step ?? null
  }

  useEffect(() => {
    if (hasRestoredStepRef.current) return
    if (initialStep === "success") return

    const stepToRestore = initialCartStepRef.current
    if (!stepToRestore) {
      // No saved step to restore — mark as done so future saveCart() updates are ignored
      if (hasRestoredCheckoutRef.current) {
        hasRestoredStepRef.current = true
      }
      return
    }

    if (
      availableSteps.length <= 1 ||
      !availableSteps.includes(stepToRestore as CheckoutStep)
    )
      return

    hasRestoredStepRef.current = true
    setCurrentStep(stepToRestore as CheckoutStep)
  }, [availableSteps, initialStep, setCurrentStep])

  // Dynamic subtotal
  const dynamicSubtotal = useMemo(
    () =>
      Object.values(dynamicItems)
        .flat()
        .reduce((sum, item) => sum + item.price, 0),
    [dynamicItems],
  )

  // Build cart state
  const cart = useMemo<CheckoutCartState>(
    () => ({
      passes: selectedPasses,
      housing,
      merch,
      patron,
      mealPlans: selectedMealPlans,
      promoCode,
      promoCodeValid,
      promoCodeDiscount,
      insurance,
      insurancePrice: insuranceAmount,
      insurancePotentialPrice: insurancePotentialAmount,
      dynamicItems,
    }),
    [
      selectedPasses,
      housing,
      merch,
      patron,
      selectedMealPlans,
      promoCode,
      promoCodeValid,
      promoCodeDiscount,
      insurance,
      insuranceAmount,
      insurancePotentialAmount,
      dynamicItems,
    ],
  )

  // Validation helpers — used by CartFooter's enable-and-validate flow.
  // findFirstIncompleteStep: today only the buyer step has formal field
  // validation. Returns its step_type when its Zod schema isn't satisfied
  // and the step exists in availableSteps; otherwise null. The helper is
  // shaped so additional gated steps can join later without breaking the
  // caller (e.g. a future "require at least one ticket" rule).
  const findFirstIncompleteStep = useCallback((): string | null => {
    if (
      !isBuyerInfoComplete &&
      (availableSteps as string[]).includes("buyer")
    ) {
      return "buyer"
    }
    return null
  }, [availableSteps, isBuyerInfoComplete])

  // findFirstProductStep: pick a step to bounce the user back to when
  // the cart is empty at confirm time. Skips structural steps (buyer,
  // confirm, success) AND content-only steps (rich-text hero, FAQs,
  // gallery, youtube) — none of those let a user add items, so bouncing
  // there from "cart is empty" is a dead end. Visited steps win.
  const findFirstProductStep = useCallback(
    (visited?: Set<string>): string | null => {
      const isProductStep = (stepName: string) => {
        if (
          stepName === "buyer" ||
          stepName === "confirm" ||
          stepName === "success"
        ) {
          return false
        }
        const config = effectiveConfiguredSteps.find(
          (c) =>
            c.step_type === stepName ||
            (c.step_type === "tickets" && stepName === "passes"),
        )
        if (config?.template && CONTENT_ONLY_TEMPLATES.has(config.template)) {
          return false
        }
        return true
      }
      const productSteps = (availableSteps as string[]).filter(isProductStep)
      if (productSteps.length === 0) return null
      if (visited && visited.size > 0) {
        const visitedProduct = productSteps.find((s) => visited.has(s))
        if (visitedProduct) return visitedProduct
      }
      return productSteps[0]
    },
    [availableSteps, effectiveConfiguredSteps],
  )

  // hasAnyCartItems: mirrors CartFooter's old `canContinue` cart check,
  // surfaced on the context so CartFooter (and any future surface that
  // needs the same predicate) can read it directly instead of replicating
  // the OR-chain locally.
  const hasAnyCartItems =
    selectedPasses.length > 0 ||
    !!housing ||
    merch.length > 0 ||
    !!patron ||
    selectedMealPlans.length > 0 ||
    Object.values(dynamicItems).some((items) => items.length > 0)

  // Dynamic item actions
  const addDynamicItem = useCallback(
    (stepType: string, item: SelectedDynamicItem) => {
      setDynamicItems((prev) => {
        const existing = prev[stepType] ?? []
        const idx = existing.findIndex((i) => i.productId === item.productId)
        if (idx >= 0) {
          const updated = [...existing]
          updated[idx] = item
          return { ...prev, [stepType]: updated }
        }
        return { ...prev, [stepType]: [...existing, item] }
      })
    },
    [],
  )

  const removeDynamicItem = useCallback(
    (stepType: string, productId: string) => {
      setDynamicItems((prev) => ({
        ...prev,
        [stepType]: (prev[stepType] ?? []).filter(
          (i) => i.productId !== productId,
        ),
      }))
    },
    [],
  )

  const updateDynamicQuantity = useCallback(
    (stepType: string, productId: string, qty: number) => {
      if (qty <= 0) {
        removeDynamicItem(stepType, productId)
        return
      }
      setDynamicItems((prev) => ({
        ...prev,
        [stepType]: (prev[stepType] ?? []).map((i) =>
          i.productId === productId
            ? { ...i, quantity: qty, price: i.product.price * qty }
            : i,
        ),
      }))
    },
    [removeDynamicItem],
  )

  // Navigation (wrap hook navigation to save cart and clear error)
  const goToStep = useCallback(
    (step: CheckoutStep) => {
      saveCart()
      goToStepRaw(step)
      setPromoError(null)
    },
    [goToStepRaw, setPromoError, saveCart],
  )

  const goToNextStep = useCallback(() => {
    saveCart()
    goToNextStepRaw()
    setPromoError(null)
  }, [goToNextStepRaw, setPromoError, saveCart])

  const goToPreviousStep = useCallback(() => {
    saveCart()
    goToPreviousStepRaw()
    setPromoError(null)
  }, [goToPreviousStepRaw, setPromoError, saveCart])

  // Pass actions (delegate to passesProvider)
  const togglePass = useCallback(
    (attendeeId: string, productId: string, quantityOverride?: number) => {
      const attendee = attendeePasses.find((a) => a.id === attendeeId)
      const product = attendee?.products.find((p) => p.id === productId)
      if (product) {
        const overridden =
          quantityOverride !== undefined
            ? { ...product, quantity: quantityOverride }
            : product
        toggleProduct(attendeeId, overridden)
      }
    },
    [attendeePasses, toggleProduct],
  )

  const resetDayProduct = useCallback(
    (attendeeId: string, productId: string) => {
      const attendee = attendeePasses.find((a) => a.id === attendeeId)
      const product = attendee?.products.find((p) => p.id === productId)
      if (product) {
        const resetProduct = {
          ...product,
          quantity: product.original_quantity ?? 0,
        }
        toggleProduct(attendeeId, resetProduct)
      }
    },
    [attendeePasses, toggleProduct],
  )

  // Insurance
  const toggleInsurance = useCallback(() => {
    setInsurance((prev) => !prev)
  }, [])

  // Cart management
  const clearCart = useCallback(() => {
    clearPersistedCart()
    clearSelections()
    clearHousing()
    setMerch([])
    clearPatron()
    setSelectedMealPlans([])
    clearPromoCode()
    setInsurance(false)
    setDynamicItems({})
  }, [
    clearPersistedCart,
    clearSelections,
    clearHousing,
    setMerch,
    clearPatron,
    setSelectedMealPlans,
    clearPromoCode,
  ])

  // Submit payment (consolidated via usePaymentSubmit)
  const { submitPayment, isSubmitting } = usePaymentSubmit({
    applicationId: application?.id,
    popupId: cityId,
    popupSlug: submitPopupSlug ?? city?.slug ?? null,
    appCredit,
    checkoutMode: checkoutPolicy.checkoutMode,
    attendeePasses,
    selectedPasses,
    housing,
    merch,
    patron,
    selectedMealPlans,
    dynamicItems,
    promoCode,
    promoCodeValid,
    insurance,
    isEditing,
    toggleEditing,
    clearCart,
    setCurrentStep,
    setPromoError,
    paymentCompleteRef,
    submitMode,
    creditsEnabled,
    buyerData:
      submitMode === "open-ticketing"
        ? {
            email:
              typeof buyerValues.email === "string" ? buyerValues.email : "",
            firstName:
              typeof buyerValues.first_name === "string"
                ? buyerValues.first_name
                : "",
            lastName:
              typeof buyerValues.last_name === "string"
                ? buyerValues.last_name
                : "",
            formData: buyerValues,
          }
        : null,
  })

  const finalSummary = useMemo(
    () => ({
      ...summary,
      dynamicSubtotal,
      subtotal: summary.subtotal + dynamicSubtotal,
      grandTotal: summary.grandTotal + dynamicSubtotal,
    }),
    [summary, dynamicSubtotal],
  )

  const value: CheckoutContextValue = {
    currentStep,
    availableSteps,
    stepConfigs: effectiveConfiguredSteps,
    cart,
    summary: finalSummary,
    allProducts: products,
    productsByStepId,
    getProductsForStep,
    attendees: attendeePasses,
    isLoading,
    isInitialLoading,
    isSubmitting,
    error,
    goToStep,
    goToNextStep,
    goToPreviousStep,
    togglePass,
    resetDayProduct,
    selectHousing,
    updateHousingQuantity,
    clearHousing,
    updateMerchQuantity,
    setPatronAmount,
    clearPatron,
    addMealPlan,
    removeMealPlan,
    setMealPlanDailyChoice,
    setMealPlanDietaryRestriction,
    setMealPlanSpecialRequest,
    applyPromoCode,
    clearPromoCode,
    toggleInsurance,
    clearCart,
    canProceedToStep: canProceedToStepFn,
    isStepComplete: isStepCompleteFn,
    submitPayment,
    isEditing,
    toggleEditing,
    editCredit,
    monthUpgradeCredit,
    termsAccepted,
    setTermsAccepted,
    addDynamicItem,
    removeDynamicItem,
    updateDynamicQuantity,
    buyerFormSchema,
    buyerValues,
    buyerErrors,
    buyerGeneralError,
    setBuyerField: (fieldName, value) => {
      setBuyerValues((current) => ({ ...current, [fieldName]: value }))
      setBuyerErrors((current) => {
        const next = { ...current }
        delete next[fieldName]
        return next
      })
      setBuyerGeneralError(null)
    },
    isBuyerInfoComplete,
    getBuyerInvalidFields,
    findFirstIncompleteStep,
    findFirstProductStep,
    hasAnyCartItems,
    visitedSteps,
    markStepVisited,
    forcedBuyerFieldsTouched,
    markBuyerFieldsTouched,
    clearForcedBuyerFieldsTouched,
    checkoutToast,
    triggerCheckoutToast,
    dismissCheckoutToast,
    cartUiEnabled,
    creditsEnabled,
  }

  return (
    <CheckoutContext.Provider value={value}>
      {children}
    </CheckoutContext.Provider>
  )
}

export function useCheckout(): CheckoutContextValue {
  const context = useContext(CheckoutContext)
  if (!context) {
    throw new Error("useCheckout must be used within a CheckoutProvider")
  }
  return context
}
