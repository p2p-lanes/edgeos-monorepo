import { useQueryClient } from "@tanstack/react-query"
import { type MutableRefObject, useCallback, useEffect } from "react"
import {
  type CartState,
  useCart,
  useClearCart,
  useSaveCart,
} from "@/hooks/useCartApi"
import { checkAndClearPurchasePending } from "@/hooks/usePaymentRedirect"
import { getProductAvailability } from "@/lib/product-availability"
import { queryKeys } from "@/lib/query-keys"
import type {
  CheckoutStep,
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
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  selectedMealPlans: SelectedMealPlanItem[]
  dynamicItems: Record<string, SelectedDynamicItem[]>
  promoCode: string
  promoCodeValid: boolean
  insurance: boolean
  currentStep: CheckoutStep
}

export interface RestorationSetters {
  setHousing: (item: SelectedHousingItem | null) => void
  setMerch: (items: SelectedMerchItem[]) => void
  setPatron: (item: SelectedPatronItem | null) => void
  setMealPlans: (items: SelectedMealPlanItem[]) => void
  setInsurance: (value: boolean) => void
  setDynamicItems: (items: Record<string, SelectedDynamicItem[]>) => void
  setPromoCode?: (code: string) => void
}

interface UseCartPersistenceParams {
  enabled?: boolean
  cityId: string | null
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

  // Cart API hooks (internalized)
  const { data: savedCart, isSuccess: cartLoaded } = useCart(effectiveCityId)
  const { save, saveImmediate, cancelPendingSave } =
    useSaveCart(effectiveCityId)
  const clearCartMutation = useClearCart(effectiveCityId)

  // --- Build CartState from the ref's current value ---
  const buildCartState = useCallback((): CartState => {
    const s = selectionStateRef.current
    return {
      passes: s.selectedPasses.map((p) => ({
        attendee_id: p.attendeeId,
        product_id: p.productId,
        quantity: p.quantity,
      })),
      housing: s.housing
        ? {
            product_id: s.housing.productId,
            check_in: s.housing.checkIn,
            check_out: s.housing.checkOut,
            quantity: s.housing.quantity,
          }
        : null,
      merch: s.merch.map((m) => ({
        product_id: m.productId,
        quantity: m.quantity,
      })),
      patron: s.patron
        ? {
            product_id: s.patron.productId,
            amount: s.patron.amount,
            is_custom_amount: s.patron.isCustomAmount,
          }
        : null,
      meal_plans: s.selectedMealPlans.map((m) => ({
        attendee_id: m.attendeeId,
        product_id: m.productId,
        daily_choices: m.dailyChoices,
        dietary_restriction: m.dietaryRestriction,
        special_request: m.specialRequest,
      })),
      promo_code: s.promoCodeValid ? s.promoCode : null,
      insurance: s.insurance,
      current_step: s.currentStep !== "success" ? s.currentStep : null,
    }
  }, [selectionStateRef])

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
            queryKeys.cart.byPopup(cityId ?? ""),
            {
              passes: [],
              housing: null,
              merch: [],
              patron: null,
              meal_plans: [],
              promo_code: null,
              insurance: false,
              current_step: null,
            },
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
