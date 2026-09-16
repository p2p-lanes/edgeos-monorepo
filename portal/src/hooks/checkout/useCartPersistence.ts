import { useQueryClient } from "@tanstack/react-query"
import { type MutableRefObject, useCallback, useEffect, useRef } from "react"
import {
  CHECKOUT_MODE,
  type CheckoutMode,
} from "@/checkout/popupCheckoutPolicy"
import {
  type CartLine,
  type CartProductLine,
  type CartState,
  EMPTY_CART,
  useCart,
  useClearCart,
  useSaveCart,
} from "@/hooks/useCartApi"
import { checkAndClearPurchasePending } from "@/hooks/usePaymentRedirect"
import { guestsForWire } from "@/lib/accommodationForm"
import { getProductAvailability } from "@/lib/product-availability"
import { queryKeys } from "@/lib/query-keys"
import type {
  CheckoutRecipientDraft,
  CheckoutStep,
  SelectedAccommodationItem,
  SelectedDynamicItem,
  SelectedHousingItem,
  SelectedMealPlanItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

export interface CartSelectionState {
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  accommodations: SelectedAccommodationItem[]
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  selectedMealPlans: SelectedMealPlanItem[]
  dynamicItems: Record<string, SelectedDynamicItem[]>
  promoCode: string
  promoCodeValid: boolean
  insurance: boolean
  currentStep: CheckoutStep
}

export interface PersistedPassSelections {
  lines: CartProductLine[]
  recipients: CheckoutRecipientDraft[]
}

export interface PersistedPassSelection {
  attendee_id?: string
  recipient_key?: string
  product_id: string
  quantity: number
}

export function buildPersistedPassSelections(
  selectedPasses: SelectedPassItem[],
): PersistedPassSelections {
  const recipients = new Map<string, CheckoutRecipientDraft>()
  const lines = selectedPasses.map<CartProductLine>((pass) => {
    if (pass.recipient) {
      recipients.set(pass.recipient.recipient_key, pass.recipient)
      return {
        kind: "product",
        assignment: {
          kind: "recipient",
          recipient_key: pass.recipient.recipient_key,
        },
        step_type: "tickets",
        product_id: pass.productId,
        quantity: pass.quantity,
        price: null,
      }
    }
    return {
      kind: "product",
      assignment: { kind: "attendee", attendee_id: pass.attendeeId },
      step_type: "tickets",
      product_id: pass.productId,
      quantity: pass.quantity,
      price: null,
    }
  })
  return { lines, recipients: [...recipients.values()] }
}

export function deriveCartRestoration(
  cart: CartState,
  checkoutMode: CheckoutMode,
) {
  const passes = cart.lines.reduce<PersistedPassSelection[]>(
    (selections, line) => {
      if (line.kind !== "product" || line.assignment.kind === "unassigned")
        return selections
      selections.push({
        product_id: line.product_id,
        quantity: line.quantity,
        ...(line.assignment.kind === "attendee"
          ? { attendee_id: line.assignment.attendee_id }
          : { recipient_key: line.assignment.recipient_key }),
      })
      return selections
    },
    [],
  )
  const unassignedProducts = cart.lines.filter(
    (line): line is CartProductLine =>
      line.kind === "product" && line.assignment.kind === "unassigned",
  )
  return {
    passes,
    recipients: cart.recipients,
    housing: cart.lines.find((line) => line.kind === "date_range"),
    merch:
      checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY
        ? []
        : unassignedProducts.filter((line) => line.step_type === "merch"),
    patron: cart.lines.find((line) => line.kind === "custom_amount"),
    meal_plans: cart.lines.flatMap((line) => {
      if (line.kind !== "meal_plan" || line.assignment.kind === "unassigned")
        return []
      return [
        {
          ...line,
          attendee_id:
            line.assignment.kind === "attendee"
              ? line.assignment.attendee_id
              : `recipient:${line.assignment.recipient_key}`,
        },
      ]
    }),
    dynamic_items: unassignedProducts.filter(
      (line) =>
        Boolean(line.step_type) &&
        (checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY ||
          line.step_type !== "merch"),
    ),
    promo_code: cart.promo_code,
    insurance: cart.insurance,
  }
}

export function buildPersistedCartState(state: CartSelectionState): CartState {
  const recipientSelections = buildPersistedPassSelections(state.selectedPasses)
  const lines: CartLine[] = [...recipientSelections.lines]
  if (state.housing) {
    lines.push({
      kind: "date_range",
      assignment: { kind: "unassigned" },
      step_type: "housing",
      product_id: state.housing.productId,
      check_in: state.housing.checkIn,
      check_out: state.housing.checkOut,
      quantity: state.housing.quantity,
    })
  }
  for (const item of state.merch) {
    lines.push({
      kind: "product",
      assignment: { kind: "unassigned" },
      step_type: "merch",
      product_id: item.productId,
      quantity: item.quantity,
      price: null,
    })
  }
  if (state.patron) {
    lines.push({
      kind: "custom_amount",
      assignment: { kind: "unassigned" },
      step_type: "patron",
      product_id: state.patron.productId,
      amount: state.patron.amount,
      is_custom_amount: state.patron.isCustomAmount,
    })
  }
  for (const item of state.selectedMealPlans) {
    const recipientKey = item.attendeeId.startsWith("recipient:")
      ? item.attendeeId.slice("recipient:".length)
      : null
    lines.push({
      kind: "meal_plan",
      assignment:
        recipientKey &&
        recipientSelections.recipients.some(
          (recipient) => recipient.recipient_key === recipientKey,
        )
          ? { kind: "recipient", recipient_key: recipientKey }
          : { kind: "attendee", attendee_id: item.attendeeId },
      step_type: "meal_plan",
      product_id: item.productId,
      daily_choices: item.dailyChoices,
      dietary_restriction: item.dietaryRestriction,
      special_request: item.specialRequest,
    })
  }
  // Keep the intent for abandoned-cart review, but never hydrate a stale quote.
  for (const item of state.accommodations) {
    lines.push({
      kind: "accommodation",
      assignment: { kind: "unassigned" },
      step_type: "accommodation",
      accommodation_id: item.accommodationId,
      check_in: item.checkIn,
      check_out: item.checkOut,
      guest_count: item.guestCount,
      // Slots the buyer has actually touched, name or answers. An untouched
      // one is a guest they have not got to yet, not a nameless occupant.
      guests: guestsForWire(item.guests),
      booker_answers: item.bookerAnswers,
    })
  }
  for (const item of Object.values(state.dynamicItems).flat()) {
    lines.push({
      kind: "product",
      assignment: { kind: "unassigned" },
      step_type: item.stepType,
      product_id: item.productId,
      quantity: item.quantity,
      price: item.price,
    })
  }
  return {
    lines,
    recipients: recipientSelections.recipients,
    promo_code: state.promoCodeValid ? state.promoCode : null,
    insurance: state.insurance,
    current_step: state.currentStep !== "success" ? state.currentStep : null,
  }
}

export interface RestorationSetters {
  setHousing: (item: SelectedHousingItem | null) => void
  setAccommodations: (items: SelectedAccommodationItem[]) => void
  setMerch: (items: SelectedMerchItem[]) => void
  setPatron: (item: SelectedPatronItem | null) => void
  setMealPlans: (items: SelectedMealPlanItem[]) => void
  setInsurance: (value: boolean) => void
  setDynamicItems: (items: Record<string, SelectedDynamicItem[]>) => void
  setPromoCode?: (code: string) => void
  restorePassRecipients?: (
    recipients: CheckoutRecipientDraft[],
    passes: PersistedPassSelection[],
  ) => void
}

interface UseCartPersistenceParams {
  enabled?: boolean
  cityId: string | null
  salesFlowId?: string | null
  initialStep: CheckoutStep
  products: ProductsPass[]
  checkoutMode: CheckoutMode
  housingPricePerDay: boolean
  /** Ref to the latest selection state — updated by the provider each render */
  selectionStateRef: MutableRefObject<CartSelectionState>
  restorationSetters: RestorationSetters
  hasRestoredCheckoutRef: MutableRefObject<boolean>
  paymentCompleteRef: MutableRefObject<boolean>
}

export function useCartPersistence({
  enabled = true,
  cityId,
  salesFlowId,
  initialStep,
  products,
  checkoutMode,
  housingPricePerDay,
  selectionStateRef,
  restorationSetters,
  hasRestoredCheckoutRef,
  paymentCompleteRef,
}: UseCartPersistenceParams) {
  const queryClient = useQueryClient()
  const effectiveCityId = enabled ? cityId : null
  const restorationScope = `${cityId ?? ""}:${salesFlowId ?? ""}`
  const previousRestorationScopeRef = useRef(restorationScope)

  // A provider can survive client-side navigation between two doors of the
  // same gathering. Reset before restoration effects run so the old flow's
  // one-shot guards cannot suppress the new flow's cart.
  if (previousRestorationScopeRef.current !== restorationScope) {
    previousRestorationScopeRef.current = restorationScope
    hasRestoredCheckoutRef.current = false
    paymentCompleteRef.current = false
  }

  // Cart API hooks (internalized)
  const { data: savedCart, isSuccess: cartLoaded } = useCart(
    effectiveCityId,
    salesFlowId,
  )
  const { save, saveImmediate, cancelPendingSave } = useSaveCart(
    effectiveCityId,
    salesFlowId,
  )
  const clearCartMutation = useClearCart(effectiveCityId, salesFlowId)

  // --- Build CartState from the ref's current value ---
  const buildCartState = useCallback(
    (): CartState => buildPersistedCartState(selectionStateRef.current),
    [selectionStateRef],
  )

  // --- Save cart immediately (for checkpoints) ---
  const saveCart = useCallback(() => {
    if (
      !cityId ||
      !enabled ||
      !hasRestoredCheckoutRef.current ||
      paymentCompleteRef.current
    )
      return

    const cartState = buildCartState()
    saveImmediate(cartState)
  }, [
    cityId,
    buildCartState,
    saveImmediate,
    hasRestoredCheckoutRef,
    paymentCompleteRef,
    enabled,
  ])

  // --- Schedule a debounced save (for auto-save on state changes) ---
  const scheduleSave = useCallback(() => {
    if (
      !cityId ||
      !enabled ||
      !hasRestoredCheckoutRef.current ||
      paymentCompleteRef.current
    )
      return

    save(buildCartState())
  }, [
    cityId,
    save,
    buildCartState,
    hasRestoredCheckoutRef,
    paymentCompleteRef,
    enabled,
  ])

  // --- Clear cart ---
  const clearCart = useCallback(() => {
    cancelPendingSave()
    clearCartMutation.mutate()
  }, [clearCartMutation, cancelPendingSave])

  // --- Cart restoration from DB ---
  useEffect(() => {
    if (!enabled || hasRestoredCheckoutRef.current || !cartLoaded || !savedCart)
      return
    if (!products.length) return

    hasRestoredCheckoutRef.current = true

    // Handle success step — clear cart and invalidate related queries
    if (initialStep === "success") {
      checkAndClearPurchasePending()
      paymentCompleteRef.current = true
      cancelPendingSave()
      clearCartMutation.mutate(undefined, {
        onSettled: () => {
          queryClient.setQueryData<CartState>(
            queryKeys.cart.byPopup(cityId ?? "", salesFlowId),
            { ...EMPTY_CART },
          )
        },
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.applications.mine(),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.payments.all,
      })
      if (cityId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.purchases.byPopup(cityId),
        })
      }
      return
    }

    const {
      setHousing,
      setMerch,
      setPatron,
      setMealPlans,
      setInsurance,
      setDynamicItems,
      restorePassRecipients,
    } = restorationSetters
    const restored = deriveCartRestoration(savedCart, checkoutMode)
    if (restored.passes.length > 0 && restorePassRecipients) {
      restorePassRecipients(restored.recipients, restored.passes)
    }
    const housingLine = restored.housing
    const merchLines = restored.merch
    const patronLine = restored.patron
    const mealPlanLines = restored.meal_plans
    const dynamicLines = restored.dynamic_items

    // Restore housing — skip products that are sold_out / ended / upcoming.
    if (housingLine) {
      const product = products.find((p) => p.id === housingLine.product_id)
      if (product) {
        const { canSelect, maxAllowedQuantity } =
          getProductAvailability(product)
        if (canSelect) {
          const start = new Date(housingLine.check_in)
          const end = new Date(housingLine.check_out)
          const nights = Math.max(
            1,
            Math.ceil(
              (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
          const savedQuantity = housingLine.quantity
          const quantity = Math.max(
            1,
            Math.min(savedQuantity, maxAllowedQuantity),
          )
          const basePrice = housingPricePerDay
            ? product.price * nights
            : product.price
          setHousing({
            productId: product.id,
            product,
            checkIn: housingLine.check_in,
            checkOut: housingLine.check_out,
            nights,
            pricePerNight: product.price,
            totalPrice: basePrice * quantity,
            pricePerDay: housingPricePerDay,
            quantity,
          })
        }
      }
    }

    // Restore merch — drop items whose product is no longer selectable.
    if (merchLines.length) {
      const restoredMerch = merchLines.reduce<SelectedMerchItem[]>(
        (acc, saved) => {
          const product = products.find((p) => p.id === saved.product_id)
          if (!product || saved.quantity <= 0) return acc
          const { canSelect, maxAllowedQuantity } =
            getProductAvailability(product)
          if (!canSelect) return acc
          const quantity =
            maxAllowedQuantity === Number.POSITIVE_INFINITY
              ? saved.quantity
              : Math.min(saved.quantity, maxAllowedQuantity)
          if (quantity <= 0) return acc
          acc.push({
            productId: product.id,
            product,
            quantity,
            unitPrice: product.price,
            totalPrice: product.price * quantity,
          })
          return acc
        },
        [],
      )
      if (restoredMerch.length > 0) setMerch(restoredMerch)
    }

    // Restore patron — donation products are not stock-bound, but still respect
    // sale-window state (upcoming/ended).
    if (patronLine) {
      const product = products.find((p) => p.id === patronLine.product_id)
      if (product && getProductAvailability(product).canSelect) {
        setPatron({
          productId: product.id,
          product,
          amount: patronLine.amount,
          isCustomAmount: patronLine.is_custom_amount,
        })
      }
    }

    // Restore meal plans — match each saved entry against the products list
    // so we can resolve the ProductsPass reference the UI needs.
    if (mealPlanLines.length) {
      const restoredMealPlans = mealPlanLines.reduce<SelectedMealPlanItem[]>(
        (acc, saved) => {
          const product = products.find((p) => p.id === saved.product_id)
          if (!product) return acc
          acc.push({
            productId: product.id,
            product,
            attendeeId: saved.attendee_id,
            dailyChoices: saved.daily_choices ?? null,
            dietaryRestriction: saved.dietary_restriction ?? null,
            specialRequest: saved.special_request ?? null,
          })
          return acc
        },
        [],
      )
      if (restoredMealPlans.length > 0) setMealPlans(restoredMealPlans)
    }

    if (dynamicLines.length) {
      const grouped: Record<string, SelectedDynamicItem[]> = {}
      for (const saved of dynamicLines) {
        const product = products.find((p) => p.id === saved.product_id)
        const stepType = saved.step_type
        if (!product || !stepType || !getProductAvailability(product).canSelect)
          continue
        grouped[stepType] = [
          ...(grouped[stepType] ?? []),
          {
            productId: product.id,
            product,
            quantity: saved.quantity,
            price: saved.price ?? product.price,
            stepType,
          },
        ]
      }
      if (Object.keys(grouped).length > 0) setDynamicItems(grouped)
    }

    // Restore insurance
    if (savedCart.insurance) {
      setInsurance(true)
    }

    // Promo code re-validation is handled in usePromoCode
    // Step restore is deferred — availableSteps depends on products loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    cartLoaded,
    savedCart,
    products,
    initialStep,
    cancelPendingSave,
    cityId,
    salesFlowId,
    clearCartMutation.mutate,
    hasRestoredCheckoutRef,
    paymentCompleteRef,
    queryClient.invalidateQueries,
    queryClient.setQueryData,
    restorationSetters,
    checkoutMode,
    housingPricePerDay,
  ])

  // --- Save on page visibility change (tab switch / minimize) ---
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveCart()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [saveCart])

  return {
    savedCart,
    cartLoaded,
    saveCart,
    scheduleSave,
    clearCart,
    cancelPendingSave,
  }
}
