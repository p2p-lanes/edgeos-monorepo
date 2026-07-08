"use client"

import { type MutableRefObject, useCallback, useEffect, useRef } from "react"
import { CheckoutService } from "@/client"
import { getProductAvailability } from "@/lib/product-availability"
import type {
  CheckoutStep,
  SelectedDynamicItem,
  SelectedMealPlanItem,
  SelectedMerchItem,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type {
  CartSelectionState,
  RestorationSetters,
} from "./useCartPersistence"

/**
 * What we persist in localStorage per popup slug.
 * Keeping the structure flat and versioned so future migrations are easy.
 */
interface OpenCartLocalStorage {
  /** CartState serialized as JSON (mirrors useCartPersistence.buildCartState) */
  items: CartItemsSnapshot
  /** backend cart id, present after first successful upsert */
  cartId: string | null
  /** HMAC restore token from the backend, non-null only when popup has a signing secret */
  restoreToken: string | null
}

/** Minimal CartState fields we need for serialization / deserialization. */
interface CartItemsSnapshot {
  passes: { attendee_id: string; product_id: string; quantity: number }[]
  housing: {
    product_id: string
    check_in: string
    check_out: string
    quantity?: number
  } | null
  merch: { product_id: string; quantity: number }[]
  patron: {
    product_id: string
    amount: number
    is_custom_amount: boolean
  } | null
  meal_plans: {
    attendee_id: string
    product_id: string
    daily_choices: Record<string, string> | null
    dietary_restriction: string | null
    special_request: string | null
  }[]
  /** Flat array of dynamic-step items, keyed by step_type for reconstruction. */
  dynamic_items: {
    step_type: string
    product_id: string
    quantity: number
    price: number
  }[]
  promo_code: string | null
  insurance: boolean
  current_step: string | null
}

interface UseOpenCartPersistenceParams {
  /** The popup slug — used as localStorage key and in API calls */
  popupSlug: string
  /** Mutable ref that the provider keeps in sync with latest selection state */
  selectionStateRef: MutableRefObject<CartSelectionState>
  /** Products for availability validation during restore */
  products: ProductsPass[]
  /** Whether housing pricing is per-day */
  housingPricePerDay: boolean
  /** State setters used to hydrate the cart from a saved snapshot */
  restorationSetters: RestorationSetters
  /** Set to true by the provider once restoration has happened — prevents
   *  double-restore and allows the debounced save to proceed */
  hasRestoredCheckoutRef: MutableRefObject<boolean>
  /** Set to true after payment succeeds — prevents saving a paid-for cart */
  paymentCompleteRef: MutableRefObject<boolean>
  /** The buyer email from the buyer form — required for upsertOpenCart */
  buyerEmail: string
  /** Initial checkout step — used to decide whether to clear on success */
  initialStep: CheckoutStep
  /** Cart id from the signed restore link (?cid=) — optional */
  cid?: string | null
  /** HMAC restore token (?sig=) — optional */
  sig?: string | null
}

function localStorageKey(slug: string): string {
  return `open-cart:${slug}`
}

function readLocalStorage(slug: string): OpenCartLocalStorage | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(localStorageKey(slug))
    if (!raw) return null
    return JSON.parse(raw) as OpenCartLocalStorage
  } catch {
    return null
  }
}

function writeLocalStorage(slug: string, data: OpenCartLocalStorage): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(localStorageKey(slug), JSON.stringify(data))
  } catch {
    // Quota exceeded or private-mode — silently ignore
  }
}

function clearLocalStorage(slug: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(localStorageKey(slug))
  } catch {
    // ignore
  }
}

/** Build a CartItemsSnapshot from the selection state ref. Mirrors useCartPersistence.buildCartState. */
function buildItemsSnapshot(state: CartSelectionState): CartItemsSnapshot {
  return {
    passes: state.selectedPasses.map((p) => ({
      attendee_id: p.attendeeId,
      product_id: p.productId,
      quantity: p.quantity,
    })),
    housing: state.housing
      ? {
          product_id: state.housing.productId,
          check_in: state.housing.checkIn,
          check_out: state.housing.checkOut,
          quantity: state.housing.quantity,
        }
      : null,
    merch: state.merch.map((m) => ({
      product_id: m.productId,
      quantity: m.quantity,
    })),
    patron: state.patron
      ? {
          product_id: state.patron.productId,
          amount: state.patron.amount,
          is_custom_amount: state.patron.isCustomAmount,
        }
      : null,
    meal_plans: state.selectedMealPlans.map((m) => ({
      attendee_id: m.attendeeId,
      product_id: m.productId,
      daily_choices: m.dailyChoices,
      dietary_restriction: m.dietaryRestriction,
      special_request: m.specialRequest,
    })),
    // Flat array — step_type is the grouping key used to reconstruct the
    // Record<string, SelectedDynamicItem[]> during hydration.
    dynamic_items: Object.values(state.dynamicItems)
      .flat()
      .map((item) => ({
        step_type: item.stepType,
        product_id: item.productId,
        quantity: item.quantity,
        price: item.price,
      })),
    promo_code: state.promoCodeValid ? state.promoCode : null,
    insurance: state.insurance,
    current_step: state.currentStep !== "success" ? state.currentStep : null,
  }
}

/** Returns true if there is at least one product selected in the cart state. */
function hasCartItems(state: CartSelectionState): boolean {
  return (
    state.selectedPasses.length > 0 ||
    state.housing !== null ||
    state.merch.length > 0 ||
    state.patron !== null ||
    state.selectedMealPlans.length > 0 ||
    Object.values(state.dynamicItems).some((items) => items.length > 0)
  )
}

/** Apply a saved CartItemsSnapshot to the UI state, validating product availability. */
function hydrateFromSnapshot(
  snapshot: CartItemsSnapshot,
  products: ProductsPass[],
  housingPricePerDay: boolean,
  restorationSetters: RestorationSetters,
): void {
  const {
    setHousing,
    setMerch,
    setPatron,
    setMealPlans,
    setInsurance,
    setDynamicItems,
    setPromoCode,
  } = restorationSetters

  // Restore housing — skip products that are sold_out / ended / upcoming.
  if (snapshot.housing) {
    const product = products.find((p) => p.id === snapshot.housing?.product_id)
    if (product) {
      const { canSelect, maxAllowedQuantity } = getProductAvailability(product)
      if (canSelect) {
        const start = new Date(snapshot.housing.check_in)
        const end = new Date(snapshot.housing.check_out)
        const nights = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        )
        const savedQuantity = snapshot.housing.quantity ?? 1
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
          checkIn: snapshot.housing.check_in,
          checkOut: snapshot.housing.check_out,
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
  if (snapshot.merch?.length) {
    const restoredMerch = snapshot.merch.reduce<SelectedMerchItem[]>(
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

  // Restore patron — respect sale-window state (upcoming/ended).
  if (snapshot.patron) {
    const product = products.find((p) => p.id === snapshot.patron?.product_id)
    if (product && getProductAvailability(product).canSelect) {
      setPatron({
        productId: product.id,
        product,
        amount: snapshot.patron.amount,
        isCustomAmount: snapshot.patron.is_custom_amount,
      })
    }
  }

  // Restore meal plans — resolve the ProductsPass reference the UI needs.
  if (snapshot.meal_plans?.length) {
    const restoredMealPlans = snapshot.meal_plans.reduce<
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
  if (snapshot.insurance) {
    setInsurance(true)
  }

  // Restore dynamic items — group flat array back into Record<string, SelectedDynamicItem[]>
  // keyed by step_type. Skip entries whose product is no longer available.
  if (snapshot.dynamic_items?.length) {
    const grouped: Record<string, SelectedDynamicItem[]> = {}
    for (const saved of snapshot.dynamic_items) {
      const product = products.find((p) => p.id === saved.product_id)
      if (!product) continue
      if (!getProductAvailability(product).canSelect) continue
      const entry: SelectedDynamicItem = {
        productId: product.id,
        product,
        quantity: saved.quantity,
        price: saved.price,
        stepType: saved.step_type,
      }
      grouped[saved.step_type] = [...(grouped[saved.step_type] ?? []), entry]
    }
    if (Object.keys(grouped).length > 0) {
      setDynamicItems(grouped)
    }
  }

  // Restore promo code — populate the input field so the gated re-validation
  // (after release settles) can confirm the code is still valid. setPromoCode
  // is optional (not present on non-open-cart flows).
  if (snapshot.promo_code && setPromoCode) {
    setPromoCode(snapshot.promo_code)
  }
}

export function useOpenCartPersistence({
  popupSlug,
  selectionStateRef,
  products,
  housingPricePerDay,
  restorationSetters,
  hasRestoredCheckoutRef,
  paymentCompleteRef,
  buyerEmail,
  initialStep,
  cid: cidParam = null,
  sig: sigParam = null,
}: UseOpenCartPersistenceParams) {
  // Track the backend cart id and restore token across renders without
  // causing re-renders (these only update localStorage, not UI).
  const cartMetaRef = useRef<{
    cartId: string | null
    restoreToken: string | null
  }>({
    cartId: null,
    restoreToken: null,
  })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Restore: signed-link takes precedence over localStorage ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot restore; products must be stable before hydrating
  useEffect(() => {
    if (hasRestoredCheckoutRef.current) return
    if (!products.length) return

    hasRestoredCheckoutRef.current = true

    // On success step, clear localStorage and do not restore.
    if (initialStep === "success") {
      clearLocalStorage(popupSlug)
      paymentCompleteRef.current = true
      return
    }

    // Signed-link restore: cid + sig present in URL
    if (cidParam && sigParam) {
      CheckoutService.restoreOpenCart({
        slug: popupSlug,
        cid: cidParam,
        sig: sigParam,
      })
        .then((openCart) => {
          // Persist the backend meta so the debounced save can merge with it
          cartMetaRef.current = {
            cartId: openCart.id,
            restoreToken: openCart.restore_token ?? null,
          }
          // Update localStorage with the restored data so same-browser
          // navigation continues from the same state.
          writeLocalStorage(popupSlug, {
            items: openCart.items as CartItemsSnapshot,
            cartId: openCart.id,
            restoreToken: openCart.restore_token ?? null,
          })
          hydrateFromSnapshot(
            openCart.items as CartItemsSnapshot,
            products,
            housingPricePerDay,
            restorationSetters,
          )
        })
        .catch(() => {
          // 403 (bad signature) or 404 (no cart / no secret) — fall back to localStorage
          const saved = readLocalStorage(popupSlug)
          if (saved) {
            cartMetaRef.current = {
              cartId: saved.cartId,
              restoreToken: saved.restoreToken,
            }
            hydrateFromSnapshot(
              saved.items,
              products,
              housingPricePerDay,
              restorationSetters,
            )
          }
        })
      return
    }

    // localStorage same-browser restore
    const saved = readLocalStorage(popupSlug)
    if (saved) {
      cartMetaRef.current = {
        cartId: saved.cartId,
        restoreToken: saved.restoreToken,
      }
      hydrateFromSnapshot(
        saved.items,
        products,
        housingPricePerDay,
        restorationSetters,
      )

      // restore_token refresh: when a cart was saved before the popup had a
      // signing secret, restoreToken is null. Issue an idempotent re-upsert with
      // the same items to obtain a fresh token now that the secret may exist.
      // Only fire when cartId is set (prior upsert succeeded) and token is absent.
      if (
        saved.cartId &&
        !saved.restoreToken &&
        saved.items &&
        buyerEmail &&
        buyerEmail.includes("@")
      ) {
        CheckoutService.upsertOpenCart({
          slug: popupSlug,
          requestBody: { email: buyerEmail, items: saved.items },
        })
          .then((openCart) => {
            if (openCart.restore_token) {
              cartMetaRef.current = {
                cartId: openCart.id,
                restoreToken: openCart.restore_token,
              }
              writeLocalStorage(popupSlug, {
                items: saved.items,
                cartId: openCart.id,
                restoreToken: openCart.restore_token,
              })
            }
          })
          .catch(() => {
            // No-op — retain existing cartId without token
          })
      }
    }
  }, [products, popupSlug, initialStep])

  // --- Debounced save: localStorage + backend upsert ---
  const scheduleSave = useCallback(() => {
    if (!hasRestoredCheckoutRef.current) return
    if (paymentCompleteRef.current) return

    const state = selectionStateRef.current
    const email =
      typeof (state as CartSelectionState & { buyerEmail?: string })
        .buyerEmail === "string"
        ? (state as CartSelectionState & { buyerEmail?: string }).buyerEmail
        : buyerEmail

    // Require a valid email AND at least one product in cart
    if (!email || !email.includes("@")) return
    if (!hasCartItems(state)) return

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      const items = buildItemsSnapshot(selectionStateRef.current)

      // Save to localStorage immediately (synchronous, fast)
      writeLocalStorage(popupSlug, {
        items,
        cartId: cartMetaRef.current.cartId,
        restoreToken: cartMetaRef.current.restoreToken,
      })

      // Persist to backend
      CheckoutService.upsertOpenCart({
        slug: popupSlug,
        requestBody: { email, items },
      })
        .then((openCart) => {
          cartMetaRef.current = {
            cartId: openCart.id,
            restoreToken: openCart.restore_token ?? null,
          }
          // Update localStorage with the backend ids
          writeLocalStorage(popupSlug, {
            items,
            cartId: openCart.id,
            restoreToken: openCart.restore_token ?? null,
          })
        })
        .catch(() => {
          // Network failure — localStorage already has the items, nothing to do
        })
    }, 800)
  }, [
    popupSlug,
    buyerEmail,
    selectionStateRef,
    hasRestoredCheckoutRef,
    paymentCompleteRef,
  ])

  // Cancel pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [])

  // --- Clear on payment success ---
  const clearOpenCart = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    clearLocalStorage(popupSlug)
    cartMetaRef.current = { cartId: null, restoreToken: null }
  }, [popupSlug])

  // --- Synchronous flush: cancel debounce and persist immediately ---
  // Called by usePaymentSubmit at the START of submitPayment (open-ticketing mode)
  // so that cartMetaRef has fresh cid/restore_token before the purchase body is built.
  const flushSave = useCallback(async (): Promise<void> => {
    if (!hasRestoredCheckoutRef.current) return
    if (paymentCompleteRef.current) return

    // Cancel any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    const state = selectionStateRef.current
    const email = buyerEmail

    if (!email || !email.includes("@")) return
    if (!hasCartItems(state)) return

    const items = buildItemsSnapshot(state)

    // Synchronous localStorage write — guarantees cid is readable even if the
    // backend call below fails.
    writeLocalStorage(popupSlug, {
      items,
      cartId: cartMetaRef.current.cartId,
      restoreToken: cartMetaRef.current.restoreToken,
    })

    // Best-effort backend upsert with a 1500ms timeout.
    const FLUSH_TIMEOUT_MS = 1500
    try {
      const openCart = await Promise.race([
        CheckoutService.upsertOpenCart({
          slug: popupSlug,
          requestBody: { email, items },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("flush timeout")),
            FLUSH_TIMEOUT_MS,
          ),
        ),
      ])
      cartMetaRef.current = {
        cartId: openCart.id,
        restoreToken: openCart.restore_token ?? null,
      }
      // Update localStorage with the fresh ids so the purchase body picks them up
      writeLocalStorage(popupSlug, {
        items,
        cartId: openCart.id,
        restoreToken: openCart.restore_token ?? null,
      })
    } catch {
      // Timeout or network failure — localStorage already has the snapshot.
      // cartMetaRef retains its previous cid if it had one.
      console.warn(
        "[useOpenCartPersistence] flushSave: upsert failed or timed out",
      )
    }
  }, [
    popupSlug,
    buyerEmail,
    selectionStateRef,
    hasRestoredCheckoutRef,
    paymentCompleteRef,
  ])

  return { scheduleSave, clearOpenCart, cartMetaRef, flushSave }
}
