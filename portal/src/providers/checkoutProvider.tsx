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
  /**
   * Field names within the buyer form that fail the current Zod schema.
   * Empty when the form is complete or no schema is configured. Used by
   * the funnel to (a) mark fields as touched + paint inline errors after
   * a Continuar/Pagar attempt, (b) decide which step to scroll back to.
   */
  getBuyerInvalidFields: () => string[]
  /**
   * Returns the step_type of the first step (in funnel order) that has
   * unmet required input — today that's the buyer step when its Zod
   * schema isn't satisfied. Returns null when nothing's missing.
   */
  findFirstIncompleteStep: () => string | null
  /**
   * Returns the step_type of the first product-bearing step the user
   * should be sent to when the cart is empty. Prefers visited steps,
   * else falls back to the first product step in funnel order.
   */
  findFirstProductStep: (visited?: Set<string>) => string | null
  /** True when at least one cartable item is present (regardless of price). */
  hasAnyCartItems: boolean
  /**
   * Set of step_types the user has visited during this session.
   * Updated by ScrollyCheckoutFlow's IntersectionObserver. Used by the
   * nav to decide whether to paint a step amber (visited but incomplete)
   * vs leave it neutral (not yet touched).
   */
  visitedSteps: Set<string>
  markStepVisited: (stepType: string) => void
  /**
   * Buyer-form fields that should always render their on-blur error
   * regardless of whether the user has actually focused them. Triggered
   * when the user presses Continuar/Pagar with incomplete data — the
   * funnel forcefully reveals every invalid field at once. Cleared
   * when the user starts editing again.
   */
  forcedBuyerFieldsTouched: Set<string>
  markBuyerFieldsTouched: (fieldNames: string[]) => void
  clearForcedBuyerFieldsTouched: () => void
  /**
   * Persistent (until dismissed) banner the funnel raises when a
   * Continuar/Pagar attempt fails validation. Holds the human message
   * plus optional chip-shaped jump-targets back to the steps that need
   * attention.
   */
  checkoutToast: CheckoutToastState | null
  triggerCheckoutToast: (state: Omit<CheckoutToastState, "id">) => void
  dismissCheckoutToast: () => void
  cartUiEnabled: boolean
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
  const { attendeePasses, toggleProduct, isEditing, toggleEditing } =
    usePassesProvider()
  const { discountApplied, setDiscount, resetDiscount } = useDiscount()
  const { getRelevantApplication } = useApplication()
  const { getCity } = useCityProvider()
  const { products: queriedProducts, loading: isLoadingProducts } =
    useGetPassesData()
  const products = productsOverride ?? queriedProducts
  const isAuthenticated = useIsAuthenticated()
  const application = getRelevantApplication()
  const appCredit = accountCreditOverride ?? application?.credit
  const city = getCity()
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

    // Buyer step is now a real `TicketingStep` row (step_type="buyer",
    // template="buyer-form") on direct-sale popups — admins can reorder it
    // and edit its title/description in the backoffice like any other step.
    // If a row already exists we use it as-is; otherwise we fall back to a
    // synthetic row so legacy popups that haven't been backfilled keep
    // working. The fallback can be removed once every direct-sale popup has
    // a buyer row.
    const existing = configuredSteps.find((s) => s.step_type === "buyer")
    if (existing) return configuredSteps

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
      template: "buyer-form",
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
  // Source of truth for "where did the user miss something?" so the
  // funnel can scroll back, paint inline errors, and prompt the user
  // through the toast. Returns [] when complete (or no schema).
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

  const [insurance, setInsurance] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [dynamicItems, setDynamicItems] = useState<
    Record<string, SelectedDynamicItem[]>
  >({})
  // Steps the user has scrolled into / clicked through during this
  // session. Session-only — no localStorage. Used purely for nav UX
  // (paint amber when "started but didn't complete").
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
      setCheckoutToast({
        ...state,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `toast-${Date.now()}`,
      })
    },
    [],
  )
  const dismissCheckoutToast = useCallback(() => setCheckoutToast(null), [])

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
    promoCode,
    promoCodeValid,
    insurance,
    scheduleSave,
  ])

  // Credit calculations
  const { editCredit, monthUpgradeCredit } = useCreditCalculation({
    attendeePasses,
    isEditing,
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

  // Cart summary
  const { summary } = useCartSummary({
    selectedPasses,
    housing,
    merch,
    patron,
    insuranceAmount,
    isEditing,
    editCredit,
    monthUpgradeCredit,
    appCredit,
  })

  // Reset state when city changes so we re-restore from new city's cart
  useEffect(() => {
    if (previousCityIdRef.current === cityId) return
    previousCityIdRef.current = cityId

    hasRestoredCheckoutRef.current = false
    setHousing(null)
    setMerch([])
    setPatron(null)
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
      promoCode,
      promoCodeValid,
      promoCodeDiscount,
      insurance,
      insuranceAmount,
      insurancePotentialAmount,
      dynamicItems,
    ],
  )

  // Item-count check used by the "you must add something to pay" gate.
  // Counts items, not money — a free product or 100%-off coupon still
  // satisfies this because the cart has cartable rows.
  const hasAnyCartItems = useMemo<boolean>(
    () =>
      selectedPasses.length > 0 ||
      !!housing ||
      merch.length > 0 ||
      !!patron ||
      Object.values(dynamicItems).some((items) => items.length > 0),
    [selectedPasses, housing, merch, patron, dynamicItems],
  )

  // Returns the funnel step the user should be sent to when the gate
  // fails. Order of precedence:
  //   1. Buyer step, if its required fields aren't fully valid.
  //   (Other product-step "at least one item" checks could grow here
  //   later; today only the buyer step has formal field validation.)
  const findFirstIncompleteStep = useCallback((): string | null => {
    if (!isBuyerInfoComplete) {
      const buyer = effectiveConfiguredSteps.find(
        (s) => s.step_type === "buyer",
      )
      if (buyer) return buyer.step_type
    }
    return null
  }, [isBuyerInfoComplete, effectiveConfiguredSteps])

  // Returns the canonical step id the user should be jumped to when
  // the cart is empty. Prefers a step they've already visited so the
  // trip back feels short; otherwise lands on the first product-bearing
  // step.
  //
  // A "product step" is one that actually carries purchasable inventory
  // — heuristically, those with a `product_category` configured OR a
  // template that exposes product rows (ticket-card, ticket-select,
  // housing-date, merch-image, patron-preset). Informational templates
  // (rich-text, image-gallery, youtube-video, faqs) are excluded so the
  // bounce-back lands on a step where the buyer can actually add
  // something.
  //
  // Returns the *checkout step id* (e.g. "passes") rather than the raw
  // step_type ("tickets") so the value lines up with `availableSteps`,
  // the DOM section ids, and the IntersectionObserver's visited set.
  const findFirstProductStep = useCallback(
    (visited?: Set<string>): string | null => {
      const PRODUCT_TEMPLATES = new Set([
        "ticket-card",
        "ticket-select",
        "housing-date",
        "merch-image",
        "patron-preset",
      ])
      const toCheckoutStepId = (stepType: string): string =>
        stepType === "tickets" ? "passes" : stepType
      const productSteps = effectiveConfiguredSteps.filter(
        (s) =>
          s.is_enabled &&
          s.step_type !== "buyer" &&
          s.step_type !== "confirm" &&
          (!!s.product_category ||
            (s.template && PRODUCT_TEMPLATES.has(s.template))),
      )
      if (productSteps.length === 0) return null
      const candidateIds = productSteps.map((s) =>
        toCheckoutStepId(s.step_type),
      )
      // Always send the buyer to the FIRST product step in funnel
      // order — "you haven't added anything anywhere, start at the
      // beginning of the product flow." `visited` is intentionally
      // ignored: the IntersectionObserver only fires for sections that
      // crossed the 30% threshold, so a fast scroll past Tickets while
      // navigating to Confirm would otherwise mis-direct the bounce to
      // a later step (e.g. Estacionamiento) that just happened to
      // cross more slowly. The function still accepts the parameter so
      // callers don't have to change as the rule evolves.
      void visited
      return candidateIds[0]
    },
    [effectiveConfiguredSteps],
  )

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
    clearHousing()
    setMerch([])
    clearPatron()
    clearPromoCode()
    setInsurance(false)
    setDynamicItems({})
  }, [clearPersistedCart, clearHousing, setMerch, clearPatron, clearPromoCode])

  // Submit payment (consolidated via usePaymentSubmit)
  const { submitPayment, isSubmitting } = usePaymentSubmit({
    applicationId: application?.id,
    popupId: cityId,
    popupSlug: submitPopupSlug,
    appCredit,
    checkoutMode: checkoutPolicy.checkoutMode,
    attendeePasses,
    selectedPasses,
    housing,
    merch,
    patron,
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
