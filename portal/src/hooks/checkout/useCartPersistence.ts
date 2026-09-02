import { useQueryClient } from "@tanstack/react-query"
import { type MutableRefObject, useCallback, useEffect, useRef } from "react"
import {
  type CartItemPass,
  type CartState,
  EMPTY_CART,
  useCart,
  useClearCart,
  useSaveCart,
} from "@/hooks/useCartApi"
import { checkAndClearPurchasePending } from "@/hooks/usePaymentRedirect"
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
  passes: CartItemPass[]
  recipients: CheckoutRecipientDraft[]
}

export function buildPersistedPassSelections(
  selectedPasses: SelectedPassItem[],
): PersistedPassSelections {
  const recipients = new Map<string, CheckoutRecipientDraft>()
  const passes = selectedPasses.map((pass) => {
    if (pass.recipient) {
      recipients.set(pass.recipient.recipient_key, pass.recipient)
      return {
        recipient_key: pass.recipient.recipient_key,
        product_id: pass.productId,
        quantity: pass.quantity,
      }
    }
    return {
      attendee_id: pass.attendeeId,
      product_id: pass.productId,
      quantity: pass.quantity,
    }
  })
  return { passes, recipients: [...recipients.values()] }
}

export function buildPersistedCartState(state: CartSelectionState): CartState {
  const recipientSelections = buildPersistedPassSelections(state.selectedPasses)
  return {
    ...recipientSelections,
    housing: state.housing
      ? {
          product_id: state.housing.productId,
          check_in: state.housing.checkIn,
          check_out: state.housing.checkOut,
          quantity: state.housing.quantity,
        }
      : null,
    merch: state.merch.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
    patron: state.patron
      ? {
          product_id: state.patron.productId,
          amount: state.patron.amount,
          is_custom_amount: state.patron.isCustomAmount,
        }
      : null,
    meal_plans: state.selectedMealPlans.map((item) => ({
      attendee_id: item.attendeeId,
      product_id: item.productId,
      daily_choices: item.dailyChoices,
      dietary_restriction: item.dietaryRestriction,
      special_request: item.specialRequest,
    })),
    // Saved, but deliberately not restored. A stay is a dated server quote and
    // a room in a cart is not held. Restoring it would claim stale inventory is
    // still bookable; the snapshot remains useful for abandoned-cart review.
    accommodations: state.accommodations.map((item) => ({
      accommodation_id: item.accommodationId,
      check_in: item.checkIn,
      check_out: item.checkOut,
      guest_count: item.guestCount,
      guests: item.guests.filter(Boolean),
    })),
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
    passes: PersistedPassSelections["passes"],
  ) => void
}

interface UseCartPersistenceParams {
  enabled?: boolean
  cityId: string | null
  salesFlowId?: string | null
  initialStep: CheckoutStep
  products: ProductsPass[]
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

    const { setHousing, setMerch, setPatron, setMealPlans, setInsurance } =
      restorationSetters

    // Restore housing — skip products that are sold_out / ended / upcoming.
    if (savedCart.housing) {
      const product = products.find(
        (p) => p.id === savedCart.housing?.product_id,
      )
      if (product) {
        const { canSelect, maxAllowedQuantity } =
          getProductAvailability(product)
        if (canSelect) {
          const start = new Date(savedCart.housing.check_in)
          const end = new Date(savedCart.housing.check_out)
          const nights = Math.max(
            1,
            Math.ceil(
              (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
          const savedQuantity = savedCart.housing.quantity ?? 1
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
            checkIn: savedCart.housing.check_in,
            checkOut: savedCart.housing.check_out,
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
    if (savedCart.merch?.length) {
      const restoredMerch = savedCart.merch.reduce<SelectedMerchItem[]>(
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
    if (savedCart.patron) {
      const product = products.find(
        (p) => p.id === savedCart.patron?.product_id,
      )
      if (product && getProductAvailability(product).canSelect) {
        setPatron({
          productId: product.id,
          product,
          amount: savedCart.patron.amount,
          isCustomAmount: savedCart.patron.is_custom_amount,
        })
      }
    }

    // Restore meal plans — match each saved entry against the products list
    // so we can resolve the ProductsPass reference the UI needs.
    if (savedCart.meal_plans?.length) {
      const restoredMealPlans = savedCart.meal_plans.reduce<
        SelectedMealPlanItem[]
      >((acc, saved) => {
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
      }, [])
      if (restoredMealPlans.length > 0) setMealPlans(restoredMealPlans)
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
