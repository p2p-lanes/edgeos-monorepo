"use client"

import { type MutableRefObject, useCallback, useEffect, useRef } from "react"
import {
  CHECKOUT_MODE,
  type CheckoutMode,
} from "@/checkout/popupCheckoutPolicy"
import { CheckoutService, type PaymentRecipientRequest } from "@/client"
import type { CartAssignment, CartLine, CartState } from "@/hooks/useCartApi"
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
import {
  buildPersistedCartState,
  deriveCartRestoration,
} from "./useCartPersistence"

/**
 * What we persist in localStorage per popup slug.
 * The current payload is canonical; older bucketed snapshots migrate on read.
 */
interface OpenCartLocalStorage {
  /** CartState serialized as JSON (mirrors useCartPersistence.buildCartState) */
  items: CartItemsSnapshot
  /** backend cart id, present after first successful upsert */
  cartId: string | null
  /** HMAC restore token from the backend, non-null only when popup has a signing secret */
  restoreToken: string | null
}

export type CartItemsSnapshot = CartState

interface UseOpenCartPersistenceParams {
  /** The popup slug — used as localStorage key and in API calls */
  popupSlug: string
  /** Canonical flow used for every anonymous cart operation. */
  flowSlug: string
  /** Enables persistence only for the anonymous checkout surface. */
  enabled: boolean
  /** Mutable ref that the provider keeps in sync with latest selection state */
  selectionStateRef: MutableRefObject<CartSelectionState>
  /** Products for availability validation during restore */
  products: ProductsPass[]
  checkoutMode?: CheckoutMode
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

/** Restoration status exposed to the CheckoutProvider.
 *
 *  The release-on-mount effect must NOT read cartMetaRef until the async
 *  restore path (signed-link or localStorage) has fully settled, because
 *  cartMetaRef is populated inside Promise callbacks.  restorationPromise
 *  resolves (always — never rejects) once all three restore paths have
 *  finished:
 *    - success-step: resolves immediately (paymentComplete branch)
 *    - no products: resolves immediately (cannot restore yet — caller handles)
 *    - signed-link: resolves after the API call resolves or rejects
 *    - plain localStorage: resolves after hydrate + optional token-refresh kick
 *
 *  The release effect awaits this promise before reading cartMetaRef so that
 *  cid/sig are always populated by the time the release decision is made.
 */
export interface OpenCartRestorationHandle {
  /** Resolves once restoration has fully settled (or was skipped). */
  restorationPromise: Promise<void>
}

export function getOpenCartScope(popupSlug: string, flowSlug?: string | null) {
  return {
    storageKey: flowSlug
      ? `open-cart:${popupSlug}:${flowSlug}`
      : `open-cart:${popupSlug}`,
    isNamedFlow: Boolean(flowSlug),
  }
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function entries(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uuidString(value: unknown): string | null {
  const parsed = nonEmptyString(value)
  return parsed &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      parsed,
    )
    ? parsed
    : null
}

function positiveInt(value: unknown, fallback = 1): number {
  if (typeof value === "boolean") return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

function nonnegativeNumber(value: unknown): number | null {
  if (
    typeof value === "boolean" ||
    value === null ||
    (typeof value !== "number" && nonEmptyString(value) === null)
  )
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function dateString(value: unknown): string | null {
  const parsed = nonEmptyString(value)
  if (!parsed) return null
  const date = new Date(`${parsed}T00:00:00Z`)
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === parsed
    ? parsed
    : null
}

function parseRecipients(value: unknown): PaymentRecipientRequest[] {
  const recipients: PaymentRecipientRequest[] = []
  const seen = new Set<string>()
  for (const entry of entries(value)) {
    const recipientKey = nonEmptyString(entry.recipient_key)
    const name = nonEmptyString(entry.name)
    if (
      !recipientKey ||
      recipientKey.length > 255 ||
      !name ||
      seen.has(recipientKey)
    )
      continue
    const email = nonEmptyString(entry.email)
    const humanId = uuidString(entry.human_id)
    const attendeeId = uuidString(entry.existing_attendee_id)
    const categoryId = uuidString(entry.category_id)
    recipients.push({
      recipient_key: recipientKey,
      name,
      ...(humanId ? { human_id: humanId } : {}),
      ...(attendeeId ? { existing_attendee_id: attendeeId } : {}),
      ...(entry.email === null || email?.includes("@") ? { email } : {}),
      ...(entry.category_id === null || categoryId
        ? { category_id: categoryId }
        : {}),
      ...(isRecord(entry.profile_snapshot)
        ? { profile_snapshot: entry.profile_snapshot }
        : {}),
    })
    seen.add(recipientKey)
  }
  return recipients
}

function legacyAssignment(
  entry: UnknownRecord,
  recipientKeys: Set<string>,
): CartAssignment {
  const recipientKey = nonEmptyString(entry.recipient_key)
  if (recipientKey && recipientKeys.has(recipientKey)) {
    return { kind: "recipient", recipient_key: recipientKey }
  }
  const attendeeId = nonEmptyString(entry.attendee_id)
  if (!attendeeId) return { kind: "unassigned" }
  if (attendeeId.startsWith("recipient:")) {
    const key = attendeeId.slice("recipient:".length)
    if (recipientKeys.has(key)) return { kind: "recipient", recipient_key: key }
  }
  return { kind: "attendee", attendee_id: attendeeId }
}

function migrateLegacySnapshot(value: UnknownRecord): CartState {
  const recipients = parseRecipients(value.recipients)
  const recipientKeys = new Set(recipients.map((item) => item.recipient_key))
  const lines: CartLine[] = []
  const passProductIds = new Set<string>()
  const addProduct = (entry: UnknownRecord, stepType: string | null) => {
    const productId = nonEmptyString(entry.product_id)
    if (!productId) return
    lines.push({
      kind: "product",
      assignment: legacyAssignment(entry, recipientKeys),
      step_type: stepType,
      product_id: productId,
      quantity: positiveInt(entry.quantity),
      price: nonnegativeNumber(entry.price),
    })
  }

  for (const entry of entries(value.passes)) {
    const productId = nonEmptyString(entry.product_id)
    if (!productId) continue
    passProductIds.add(productId)
    addProduct(entry, "tickets")
  }
  if (isRecord(value.housing)) {
    const productId = nonEmptyString(value.housing.product_id)
    const checkIn = dateString(value.housing.check_in)
    const checkOut = dateString(value.housing.check_out)
    if (productId && checkIn && checkOut) {
      lines.push({
        kind: "date_range",
        assignment: legacyAssignment(value.housing, recipientKeys),
        step_type: "housing",
        product_id: productId,
        check_in: checkIn,
        check_out: checkOut,
        quantity: positiveInt(value.housing.quantity),
      })
    }
  }
  for (const entry of entries(value.merch)) addProduct(entry, "merch")
  if (isRecord(value.patron)) {
    const productId = nonEmptyString(value.patron.product_id)
    const amount = nonnegativeNumber(value.patron.amount)
    if (productId && amount !== null) {
      lines.push({
        kind: "custom_amount",
        assignment: legacyAssignment(value.patron, recipientKeys),
        step_type: "patron",
        product_id: productId,
        amount,
        is_custom_amount:
          typeof value.patron.is_custom_amount === "boolean"
            ? value.patron.is_custom_amount
            : false,
      })
    }
  }
  for (const entry of entries(value.meal_plans)) {
    const productId = nonEmptyString(entry.product_id)
    if (!productId) continue
    const choices = isRecord(entry.daily_choices)
      ? Object.fromEntries(
          Object.entries(entry.daily_choices).filter(
            (pair): pair is [string, string] => typeof pair[1] === "string",
          ),
        )
      : null
    lines.push({
      kind: "meal_plan",
      assignment: legacyAssignment(entry, recipientKeys),
      step_type: "meal_plan",
      product_id: productId,
      daily_choices: choices,
      dietary_restriction:
        typeof entry.dietary_restriction === "string"
          ? entry.dietary_restriction
          : null,
      special_request:
        typeof entry.special_request === "string"
          ? entry.special_request
          : null,
    })
  }
  for (const entry of entries(value.accommodations)) {
    const accommodationId = nonEmptyString(entry.accommodation_id)
    const checkIn = dateString(entry.check_in)
    const checkOut = dateString(entry.check_out)
    if (!accommodationId || !checkIn || !checkOut) continue
    const guestCount = positiveInt(entry.guest_count, 0)
    lines.push({
      kind: "accommodation",
      assignment: legacyAssignment(entry, recipientKeys),
      step_type: "housing",
      accommodation_id: accommodationId,
      check_in: checkIn,
      check_out: checkOut,
      guest_count: guestCount || null,
      guests: Array.isArray(entry.guests)
        ? entry.guests.filter(
            (guest): guest is string => typeof guest === "string",
          )
        : [],
    })
  }
  for (const entry of entries(value.dynamic_items)) {
    const productId = nonEmptyString(entry.product_id)
    if (!productId || passProductIds.has(productId)) continue
    addProduct(entry, nonEmptyString(entry.step_type))
  }
  return {
    lines,
    recipients,
    promo_code: typeof value.promo_code === "string" ? value.promo_code : null,
    insurance: typeof value.insurance === "boolean" ? value.insurance : false,
    current_step:
      typeof value.current_step === "string" ? value.current_step : null,
  }
}

export function normalizeCartItemsSnapshot(
  value: unknown,
): { items: CartItemsSnapshot; migrated: boolean } | null {
  if (!isRecord(value)) return null
  if ("lines" in value) {
    if (!Array.isArray(value.lines)) return null
    return { items: value as unknown as CartItemsSnapshot, migrated: false }
  }
  return { items: migrateLegacySnapshot(value), migrated: true }
}

function readLocalStorage(storageKey: string): OpenCartLocalStorage | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    const normalized = normalizeCartItemsSnapshot(parsed.items)
    if (!normalized) return null
    const saved: OpenCartLocalStorage = {
      items: normalized.items,
      cartId: typeof parsed.cartId === "string" ? parsed.cartId : null,
      restoreToken:
        typeof parsed.restoreToken === "string" ? parsed.restoreToken : null,
    }
    writeLocalStorage(storageKey, saved)
    return saved
  } catch {
    return null
  }
}

function writeLocalStorage(
  storageKey: string,
  data: OpenCartLocalStorage,
): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(data))
  } catch {
    // Quota exceeded or private-mode — silently ignore
  }
}

function clearLocalStorage(storageKey: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // ignore
  }
}

function restoreScopedOpenCart(
  popupSlug: string,
  flowSlug: string,
  cid: string,
  sig: string,
) {
  return CheckoutService.restoreFlowCart({
    slug: popupSlug,
    flowSlug,
    cid,
    sig,
  })
}

function upsertScopedOpenCart(
  popupSlug: string,
  flowSlug: string,
  email: string,
  items: CartItemsSnapshot,
) {
  const requestBody = { email, items }
  return CheckoutService.upsertFlowCart({
    slug: popupSlug,
    flowSlug,
    requestBody,
  })
}

/** Build a CartItemsSnapshot from the selection state ref. Mirrors useCartPersistence.buildCartState. */
export function buildItemsSnapshot(
  state: CartSelectionState,
): CartItemsSnapshot {
  return buildPersistedCartState(state)
}

/** Returns true if there is at least one product selected in the cart state. */
export function hasCartItems(state: CartSelectionState): boolean {
  return (
    state.selectedPasses.length > 0 ||
    state.housing !== null ||
    state.accommodations.length > 0 ||
    state.merch.length > 0 ||
    state.patron !== null ||
    state.selectedMealPlans.length > 0 ||
    Object.values(state.dynamicItems).some((items) => items.length > 0)
  )
}

/** Apply a saved CartItemsSnapshot to the UI state, validating product availability. */
export function hydrateFromSnapshot(
  cartState: CartItemsSnapshot,
  products: ProductsPass[],
  housingPricePerDay: boolean,
  restorationSetters: RestorationSetters,
  checkoutMode: CheckoutMode = CHECKOUT_MODE.PASS_SYSTEM,
): void {
  const snapshot = deriveCartRestoration(cartState, checkoutMode)
  const {
    setHousing,
    setMerch,
    setPatron,
    setMealPlans,
    setInsurance,
    setDynamicItems,
    setPromoCode,
    restorePassRecipients,
  } = restorationSetters

  if (snapshot.passes.length > 0 && restorePassRecipients) {
    restorePassRecipients(snapshot.recipients, snapshot.passes)
  }

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
  if (snapshot.merch.length) {
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
  if (snapshot.meal_plans.length) {
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
  if (cartState.insurance) {
    setInsurance(true)
  }

  // Restore dynamic items — group flat array back into Record<string, SelectedDynamicItem[]>
  // keyed by step_type. Skip entries whose product is no longer available.
  if (snapshot.dynamic_items.length) {
    const grouped: Record<string, SelectedDynamicItem[]> = {}
    for (const saved of snapshot.dynamic_items) {
      const product = products.find((p) => p.id === saved.product_id)
      const stepType = saved.step_type
      if (!product || !stepType) continue
      if (!getProductAvailability(product).canSelect) continue
      const entry: SelectedDynamicItem = {
        productId: product.id,
        product,
        quantity: saved.quantity,
        price: saved.price ?? product.price,
        stepType,
      }
      grouped[stepType] = [...(grouped[stepType] ?? []), entry]
    }
    if (Object.keys(grouped).length > 0) {
      setDynamicItems(grouped)
    }
  }

  // Restore promo code — populate the input field so the gated re-validation
  // (after release settles) can confirm the code is still valid. setPromoCode
  // is optional (not present on non-open-cart flows).
  if (cartState.promo_code && setPromoCode) {
    setPromoCode(cartState.promo_code)
  }
}

export function useOpenCartPersistence({
  popupSlug,
  flowSlug,
  enabled,
  selectionStateRef,
  products,
  checkoutMode = CHECKOUT_MODE.PASS_SYSTEM,
  housingPricePerDay,
  restorationSetters,
  hasRestoredCheckoutRef,
  paymentCompleteRef,
  buyerEmail,
  initialStep,
  cid: cidParam = null,
  sig: sigParam = null,
}: UseOpenCartPersistenceParams) {
  const scope = getOpenCartScope(popupSlug, flowSlug)
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

  // In-flight upsert serializer: both the debounced save and the mount
  // restore-refresh funnel through a single chained promise so cartMetaRef
  // is never overwritten by a stale out-of-order response (P4 fix).
  const inFlightUpsertRef = useRef<Promise<void>>(Promise.resolve())

  // Restoration completion signal (P1 fix).
  // The release effect in checkoutProvider must not read cartMetaRef until
  // the async restore path has fully settled — signed-link API response or
  // localStorage + optional token-refresh kick. We expose a promise that
  // resolves once all three restore paths have finished. Never rejects.
  const restorationResolveRef = useRef<(() => void) | null>(null)
  const restorationPromiseRef = useRef<Promise<void>>(
    new Promise<void>((resolve) => {
      restorationResolveRef.current = resolve
    }),
  )
  const previousScopeRef = useRef(scope.storageKey)

  if (previousScopeRef.current !== scope.storageKey) {
    previousScopeRef.current = scope.storageKey
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    cartMetaRef.current = { cartId: null, restoreToken: null }
    inFlightUpsertRef.current = Promise.resolve()
    hasRestoredCheckoutRef.current = false
    paymentCompleteRef.current = false
    restorationPromiseRef.current = new Promise<void>((resolve) => {
      restorationResolveRef.current = resolve
    })
  }

  // --- Restore: signed-link takes precedence over localStorage ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot restore; products must be stable before hydrating
  useEffect(() => {
    const restorationScope = scope.storageKey
    const resolveRestoration = restorationResolveRef.current
    if (!enabled) {
      resolveRestoration?.()
      return
    }
    if (hasRestoredCheckoutRef.current) return

    // P5 fix: when products have not loaded yet, we cannot restore — do NOT
    // mark as restored; leave restorationPromise pending so the release effect
    // also waits.  The effect re-runs once products.length > 0.
    if (!products.length) return

    hasRestoredCheckoutRef.current = true

    // On success step, clear localStorage and do not restore.
    if (initialStep === "success") {
      clearLocalStorage(scope.storageKey)
      paymentCompleteRef.current = true
      // Resolve immediately — nothing to wait for.
      resolveRestoration?.()
      return
    }

    const savedSnapshot = readLocalStorage(scope.storageKey)
    const hasSignedUrl = Boolean(cidParam && sigParam)
    const restoreCartId = hasSignedUrl ? cidParam : savedSnapshot?.cartId
    const restoreToken = hasSignedUrl ? sigParam : savedSnapshot?.restoreToken

    // A signed URL wins, but a same-browser cart can use its stored proof to
    // reconcile with the backend before trusting its local snapshot.
    if (restoreCartId && restoreToken) {
      // Resolve restorationPromise only AFTER the async call settles so that
      // the release effect sees the populated cartMetaRef (P1 fix).
      restoreScopedOpenCart(popupSlug, flowSlug, restoreCartId, restoreToken)
        .then((openCart) => {
          if (previousScopeRef.current !== restorationScope) return
          const backendItems = openCart.items as unknown as CartItemsSnapshot
          const local = savedSnapshot
          const repairFromLocal =
            backendItems.lines.length === 0 &&
            local?.cartId === openCart.id &&
            local.items.lines.length > 0
          const restoredItems = repairFromLocal ? local.items : backendItems
          cartMetaRef.current = {
            cartId: openCart.id,
            restoreToken: openCart.restore_token ?? null,
          }
          writeLocalStorage(scope.storageKey, {
            items: restoredItems,
            cartId: openCart.id,
            restoreToken: openCart.restore_token ?? null,
          })
          hydrateFromSnapshot(
            restoredItems,
            products,
            housingPricePerDay,
            restorationSetters,
            checkoutMode,
          )
          if (!repairFromLocal) return

          inFlightUpsertRef.current = inFlightUpsertRef.current
            .then(() =>
              upsertScopedOpenCart(
                popupSlug,
                flowSlug,
                openCart.email,
                restoredItems,
              ),
            )
            .then((repairedCart) => {
              if (previousScopeRef.current !== restorationScope) return
              cartMetaRef.current = {
                cartId: repairedCart.id,
                restoreToken: repairedCart.restore_token ?? null,
              }
              writeLocalStorage(scope.storageKey, {
                items: restoredItems,
                cartId: repairedCart.id,
                restoreToken: repairedCart.restore_token ?? null,
              })
            })
            .catch(() => {
              // The canonical local snapshot remains available for retry.
            })
          return inFlightUpsertRef.current
        })
        .catch(() => {
          if (previousScopeRef.current !== restorationScope) return
          // 403 (bad signature) or 404 (no cart / no secret) — fall back to localStorage
          const saved = savedSnapshot
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
              checkoutMode,
            )
          }
        })
        .finally(() => {
          // cartMetaRef is now populated (or fallback localStorage applied).
          // Signal the release effect that it can safely read cartMetaRef.
          resolveRestoration?.()
        })
      return
    }

    // localStorage same-browser restore
    const saved = savedSnapshot
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
        checkoutMode,
      )

      // restore_token refresh: when a cart was saved before the popup had a
      // signing secret, restoreToken is null. Issue an idempotent re-upsert with
      // the same items to obtain a fresh token now that the secret may exist.
      // Only fire when cartId is set (prior upsert succeeded) and token is absent.
      // Serialize through inFlightUpsertRef so a concurrent debounced save does
      // not race this call and clobber cartMetaRef with a mismatched cid/sig (P4).
      if (
        saved.cartId &&
        !saved.restoreToken &&
        saved.items &&
        buyerEmail &&
        buyerEmail.includes("@")
      ) {
        // Signal restoration done before the token-refresh kick, because the
        // existing cartId+null token is sufficient proof for the release call.
        resolveRestoration?.()

        inFlightUpsertRef.current = inFlightUpsertRef.current.then(() =>
          upsertScopedOpenCart(popupSlug, flowSlug, buyerEmail, saved.items)
            .then((openCart) => {
              if (previousScopeRef.current !== restorationScope) return
              if (openCart.restore_token) {
                cartMetaRef.current = {
                  cartId: openCart.id,
                  restoreToken: openCart.restore_token,
                }
                writeLocalStorage(scope.storageKey, {
                  items: saved.items,
                  cartId: openCart.id,
                  restoreToken: openCart.restore_token,
                })
              }
            })
            .catch(() => {
              // No-op — retain existing cartId without token
            }),
        )
      } else {
        // No token-refresh needed — signal restoration done immediately.
        resolveRestoration?.()
      }
    } else {
      // No localStorage data — nothing to restore.
      resolveRestoration?.()
    }
  }, [enabled, products, popupSlug, flowSlug, scope.storageKey, initialStep])

  // --- Debounced save: localStorage + backend upsert ---
  const scheduleSave = useCallback(() => {
    if (!enabled) return
    if (!hasRestoredCheckoutRef.current) return
    if (paymentCompleteRef.current) return

    const state = selectionStateRef.current
    const email =
      typeof (state as CartSelectionState & { buyerEmail?: string })
        .buyerEmail === "string"
        ? (state as CartSelectionState & { buyerEmail?: string }).buyerEmail
        : buyerEmail

    // Need at least one product to save. The email is only required for the
    // backend upsert (cross-device recovery) — the localStorage copy below is
    // written regardless, so a same-browser reload keeps the cart even before
    // the buyer reaches the "your information" step and enters an email.
    if (!hasCartItems(state)) return

    const saveScope = scope.storageKey
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      if (previousScopeRef.current !== saveScope) return
      const items = buildItemsSnapshot(selectionStateRef.current)

      // Save to localStorage immediately (synchronous, fast)
      writeLocalStorage(scope.storageKey, {
        items,
        cartId: cartMetaRef.current.cartId,
        restoreToken: cartMetaRef.current.restoreToken,
      })

      // The backend upsert (cross-device recovery) needs an email; until the
      // buyer provides one the localStorage copy above is enough.
      if (!email || !email.includes("@")) return

      // Serialize through inFlightUpsertRef so this call cannot race the
      // mount restore-refresh upsert and clobber cartMetaRef (P4 fix).
      inFlightUpsertRef.current = inFlightUpsertRef.current.then(() =>
        upsertScopedOpenCart(popupSlug, flowSlug, email, items)
          .then((openCart) => {
            if (previousScopeRef.current !== saveScope) return
            cartMetaRef.current = {
              cartId: openCart.id,
              restoreToken: openCart.restore_token ?? null,
            }
            // Update localStorage with the backend ids
            writeLocalStorage(scope.storageKey, {
              items,
              cartId: openCart.id,
              restoreToken: openCart.restore_token ?? null,
            })
          })
          .catch(() => {
            // Network failure — localStorage already has the items, nothing to do
          }),
      )
    }, 800)
  }, [
    enabled,
    popupSlug,
    flowSlug,
    scope.storageKey,
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
    clearLocalStorage(scope.storageKey)
    cartMetaRef.current = { cartId: null, restoreToken: null }
  }, [scope.storageKey])

  // --- Synchronous flush: cancel debounce and persist immediately ---
  // Called by usePaymentSubmit at the START of submitPayment (open-ticketing mode)
  // so that cartMetaRef has fresh cid/restore_token before the purchase body is built.
  const flushSave = useCallback(async (): Promise<void> => {
    if (!enabled) return
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
    const saveScope = scope.storageKey

    // Synchronous localStorage write — guarantees cid is readable even if the
    // backend call below fails.
    writeLocalStorage(scope.storageKey, {
      items,
      cartId: cartMetaRef.current.cartId,
      restoreToken: cartMetaRef.current.restoreToken,
    })

    // Best-effort backend upsert with a 1500ms timeout.
    const FLUSH_TIMEOUT_MS = 1500
    try {
      const openCart = await Promise.race([
        upsertScopedOpenCart(popupSlug, flowSlug, email, items),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("flush timeout")),
            FLUSH_TIMEOUT_MS,
          ),
        ),
      ])
      if (previousScopeRef.current !== saveScope) return
      cartMetaRef.current = {
        cartId: openCart.id,
        restoreToken: openCart.restore_token ?? null,
      }
      // Update localStorage with the fresh ids so the purchase body picks them up
      writeLocalStorage(scope.storageKey, {
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
    enabled,
    popupSlug,
    flowSlug,
    scope.storageKey,
    buyerEmail,
    selectionStateRef,
    hasRestoredCheckoutRef,
    paymentCompleteRef,
  ])

  return {
    scheduleSave,
    clearOpenCart,
    cartMetaRef,
    flushSave,
    restorationPromise: restorationPromiseRef.current,
  }
}
