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
  useProductCategories,
  usePromoCode,
} from "@/hooks/checkout"
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
  passProducts: ProductsPass[]
  housingProducts: ProductsPass[]
  merchProducts: ProductsPass[]
  patronProducts: ProductsPass[]
  allProducts: ProductsPass[]
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
  cartUiEnabled: boolean
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

    // Inherit show_title/show_watermark from confirm: buyer sits adjacent to it
    // and admins typically want consistent display between the two.
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

    const withoutBuyer = configuredSteps.filter(
      (step) => step.step_type !== "buyer",
    )
    const confirmIndex = withoutBuyer.findIndex(
      (step) => step.step_type === "confirm",
    )

    if (confirmIndex === -1) {
      return [...withoutBuyer, buyerStep]
    }

    return [
      ...withoutBuyer.slice(0, confirmIndex),
      buyerStep,
      ...withoutBuyer.slice(confirmIndex),
    ]
  }, [buyerFormSchema, cityId, configuredSteps, submitMode, t])

  const isBuyerInfoComplete =
    !buyerFormSchema ||
    buildFormZodSchema(buyerFormSchema, false).safeParse(buyerValues).success

  // True while step configs or products are still loading on first render.
  // Why: when both queries are pending, availableSteps falls back to
  // ["passes", "confirm"] with default labels and the cart total reads $0,
  // producing a brief flash of a "broken" checkout before real data arrives.
  const isInitialLoading =
    !!cityId && isAuthenticated && (isLoadingSteps || isLoadingProducts)

  // Product categories
  const { passProducts, housingProducts, merchProducts, patronProducts } =
    useProductCategories(products)

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
  } = useHousingSelection(housingProducts, housingPricePerDay)

  const { merch, setMerch, updateMerchQuantity } =
    useMerchSelection(merchProducts)

  const { patron, setPatron, setPatronAmount, clearPatron } =
    usePatronSelection(patronProducts)

  const [insurance, setInsurance] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [dynamicItems, setDynamicItems] = useState<
    Record<string, SelectedDynamicItem[]>
  >({})

  // Build selected passes from attendeePasses
  const selectedPasses = useMemo<SelectedPassItem[]>(() => {
    const passes: SelectedPassItem[] = []

    for (const attendee of attendeePasses) {
      for (const product of attendee.products) {
        if (product.selected && !(isEditing && product.purchased)) {
          const isDayPass = product.duration_type === "day"
          const quantity =
            checkoutPolicy.checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY
              ? supportsQuantitySelector(product.max_quantity) || isDayPass
                ? (product.quantity ?? 1)
                : 1
              : isDayPass
                ? (product.quantity ?? 1) - (product.original_quantity ?? 0)
                : supportsQuantitySelector(product.max_quantity)
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
    patronCount: patronProducts.length,
    housingCount: housingProducts.length,
    merchCount: merchProducts.length,
    selectedPassesCount: selectedPasses.length,
    dynamicItemsCount: Object.values(dynamicItems).flat().length,
    isEditing,
    allProducts: products,
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
    passProducts,
    housingProducts,
    merchProducts,
    patronProducts,
    allProducts: products,
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
