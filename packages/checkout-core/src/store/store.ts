// The orchestration brain: a minimal framework-agnostic store that wires steps +
// selection + order assembly + pricing (server-authoritative) + cart persistence
// + analytics into one subscribe/getState/action surface. The React adapter
// (Plan 3) is a thin bridge over this; the portal's checkoutProvider collapses
// into it. No React here.

import type { AnalyticsBus } from "../analytics/bus"
import type { AnalyticsPopup, AnalyticsProduct } from "../analytics/events"
import type { CheckoutClient } from "../client"
import { type CartDriver, type CartMeta, createCartDriver } from "../cart/driver"
import { isBuyerComplete, toBuyerInfo } from "../form/buyer"
import { buildFormZodSchema } from "../form/schema"
import { buildOrderLines } from "../order/buildOrderLines"
import {
  createPricingDriver,
  type PricingDriver,
  type PricingState,
} from "../pricing/driver"
import {
  canProceedToStep,
  nextStep as nextStepFn,
  previousStep as previousStepFn,
} from "../steps/navigation"
import {
  buildProductsByStepId,
  deriveAvailableSteps,
} from "../steps/derive"
import {
  clearHousing as clearHousingFn,
  emptySelection,
  type HousingInput,
  selectHousing as selectHousingFn,
  type SelectionState,
  setCoupon as setCouponFn,
  setHousingQuantity as setHousingQuantityFn,
  setInsurance as setInsuranceFn,
  setQuantity as setQuantityFn,
  totalSelectedQuantity,
} from "../selection/state"
import type {
  CheckoutRuntimeProduct,
  CheckoutRuntimeResponse,
} from "../types/api"
import type { CheckoutStep } from "../types/checkout"
import type { ApplicationFormSchema } from "../types/form"

export interface BuyerState {
  /** All buyer form values (custom fields still prefixed `custom_`). */
  values: Record<string, unknown>
}

export interface CouponState {
  code: string | null
  valid: boolean
}

export interface CheckoutStoreState {
  runtime: CheckoutRuntimeResponse | null
  steps: CheckoutStep[]
  currentStep: CheckoutStep
  selection: SelectionState
  buyer: BuyerState
  coupon: CouponState
  pricing: PricingState
  cartMeta: CartMeta
  submitting: boolean
  error: string | null
}

export interface SubmitResult {
  status: string
  paymentId: string
  checkoutUrl: string
  redirectUrl: string | null
  amount: string
  currency: string
}

export interface CheckoutStoreConfig {
  client: CheckoutClient
  /** Seed runtime to avoid a double fetch (the portal already has it). */
  runtime?: CheckoutRuntimeResponse
  analytics?: AnalyticsBus
  pricingDebounceMs?: number
  cartDebounceMs?: number
}

export interface CheckoutStore {
  getState(): CheckoutStoreState
  subscribe(listener: (state: CheckoutStoreState) => void): () => void
  /** Fetch runtime (if not seeded), derive steps, emit ViewContent. */
  load(): Promise<void>
  setQuantity(productId: string, quantity: number): void
  selectProduct(productId: string): void
  selectHousing(input: HousingInput): void
  setHousingQuantity(quantity: number): void
  clearHousing(): void
  setInsurance(insurance: boolean): void
  applyCoupon(code: string): Promise<boolean>
  clearCoupon(): void
  setBuyer(patch: Record<string, unknown>): void
  goToStep(step: CheckoutStep): boolean
  nextStep(): void
  previousStep(): void
  submit(): Promise<SubmitResult>
  dispose(): void
}

function toAnalyticsPopup(popup: Record<string, unknown>): AnalyticsPopup {
  return {
    id: String(popup.id ?? ""),
    slug: String(popup.slug ?? ""),
    name: (popup.name as string | null | undefined) ?? null,
    currency: (popup.currency as string | null | undefined) ?? null,
  }
}

function toAnalyticsProduct(p: CheckoutRuntimeProduct): AnalyticsProduct {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    currency: p.currency,
    category: p.category,
    is_active: p.is_active,
  }
}

export function createCheckoutStore(
  config: CheckoutStoreConfig,
): CheckoutStore {
  const { client, analytics } = config
  const listeners = new Set<(state: CheckoutStoreState) => void>()

  const pricing: PricingDriver = createPricingDriver({
    client,
    debounceMs: config.pricingDebounceMs,
  })
  const cart: CartDriver = createCartDriver({
    client,
    debounceMs: config.cartDebounceMs,
  })

  let formSchema: ApplicationFormSchema | null = null

  let state: CheckoutStoreState = {
    runtime: config.runtime ?? null,
    steps: [],
    currentStep: "passes",
    selection: emptySelection(),
    buyer: { values: {} },
    coupon: { code: null, valid: false },
    pricing: pricing.getState(),
    cartMeta: cart.getMeta(),
    submitting: false,
    error: null,
  }

  function notify() {
    for (const l of listeners) l(state)
  }
  function set(patch: Partial<CheckoutStoreState>) {
    state = { ...state, ...patch }
    notify()
  }

  pricing.subscribe((ps) => set({ pricing: ps }))

  function productById(id: string): CheckoutRuntimeProduct | undefined {
    return state.runtime?.products.find((p) => p.id === id)
  }

  function buyerEmail(): string {
    return String(state.buyer.values.email ?? "")
  }

  function buyerComplete(): boolean {
    if (formSchema) return isBuyerComplete(buildFormZodSchema(formSchema), state.buyer.values)
    const v = state.buyer.values
    return (
      !!String(v.email ?? "") &&
      !!String(v.first_name ?? "") &&
      !!String(v.last_name ?? "")
    )
  }

  function deriveSteps(runtime: CheckoutRuntimeResponse): CheckoutStep[] {
    const byStep = buildProductsByStepId(runtime.ticketing_steps, runtime.products)
    return deriveAvailableSteps(runtime.ticketing_steps, byStep)
  }

  function applyRuntime(runtime: CheckoutRuntimeResponse) {
    const fs = runtime.form_schema as ApplicationFormSchema | null
    formSchema = fs && typeof fs === "object" && "base_fields" in fs ? fs : null
    const steps = deriveSteps(runtime)
    set({ runtime, steps, currentStep: steps[0] ?? "passes" })
    if (analytics) {
      analytics.viewContent(
        toAnalyticsPopup(runtime.popup),
        runtime.products.map(toAnalyticsProduct),
      )
    }
  }

  // Re-price + persist whenever the selection or coupon or insurance changes.
  function refreshDerived() {
    pricing.update({
      products: buildOrderLines(state.selection),
      couponCode: state.coupon.valid ? state.coupon.code : null,
      insurance: state.selection.insurance,
    })
    const email = buyerEmail()
    if (email) cart.save(email, state.selection, { currentStep: state.currentStep })
  }

  function commitSelection(next: SelectionState) {
    set({ selection: next })
    refreshDerived()
  }

  function doSetQuantity(productId: string, quantity: number) {
    const prev = state.selection.quantities[productId] ?? 0
    commitSelection(setQuantityFn(state.selection, productId, quantity))
    const added = quantity - prev
    if (added > 0 && analytics && state.runtime) {
      const product = productById(productId)
      if (product) {
        analytics.addToCart(
          toAnalyticsPopup(state.runtime.popup),
          toAnalyticsProduct(product),
          added,
        )
      }
    }
  }

  function doGoToStep(step: CheckoutStep): boolean {
    const ok = canProceedToStep(step, {
      availableSteps: state.steps,
      selectedPassesCount: 0,
      dynamicItemsCount: totalSelectedQuantity(state.selection),
      isEditing: false,
      buyerInfoComplete: buyerComplete(),
    })
    if (ok) set({ currentStep: step })
    return ok
  }

  return {
    getState() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async load() {
      const runtime = state.runtime ?? (await client.getRuntime())
      applyRuntime(runtime)
    },
    setQuantity(productId, quantity) {
      doSetQuantity(productId, quantity)
    },
    selectProduct(productId) {
      const current = state.selection.quantities[productId] ?? 0
      doSetQuantity(productId, current > 0 ? 0 : 1)
    },
    selectHousing(input) {
      commitSelection(selectHousingFn(state.selection, input))
    },
    setHousingQuantity(quantity) {
      commitSelection(setHousingQuantityFn(state.selection, quantity))
    },
    clearHousing() {
      commitSelection(clearHousingFn(state.selection))
    },
    setInsurance(insurance) {
      commitSelection(setInsuranceFn(state.selection, insurance))
    },
    async applyCoupon(code) {
      try {
        const res = await client.validateCoupon(code)
        const valid = res.valid === true
        set({ coupon: { code, valid } })
        commitSelection(setCouponFn(state.selection, valid ? code : null))
        return valid
      } catch {
        set({ coupon: { code, valid: false } })
        commitSelection(setCouponFn(state.selection, null))
        return false
      }
    },
    clearCoupon() {
      set({ coupon: { code: null, valid: false } })
      commitSelection(setCouponFn(state.selection, null))
    },
    setBuyer(patch) {
      set({ buyer: { values: { ...state.buyer.values, ...patch } } })
    },
    goToStep(step) {
      return doGoToStep(step)
    },
    nextStep() {
      doGoToStep(nextStepFn(state.steps, state.currentStep))
    },
    previousStep() {
      // Backward navigation is always allowed.
      set({ currentStep: previousStepFn(state.steps, state.currentStep) })
    },
    async submit() {
      if (state.submitting) throw new Error("Payment already in progress")
      const products = buildOrderLines(state.selection)
      if (products.length === 0) throw new Error("Nothing selected")
      set({ submitting: true, error: null })

      try {
        const email = buyerEmail()
        // Flush the cart first so cid/sig continuity proof is fresh.
        const meta = email
          ? await cart.flush(email, state.selection, {
              currentStep: state.currentStep,
            })
          : cart.getMeta()
        set({ cartMeta: meta })

        const v = state.buyer.values
        const result = await client.purchase({
          products,
          buyer: toBuyerInfo({
            email,
            firstName: String(v.first_name ?? ""),
            lastName: String(v.last_name ?? ""),
            formData: v,
          }),
          coupon_code: state.coupon.valid ? state.coupon.code : null,
          insurance: state.selection.insurance || undefined,
          cid: meta.cartId,
          sig: meta.restoreToken,
        })

        if (result.status === "approved" && analytics && state.runtime) {
          analytics.purchase({
            paymentId: result.payment_id,
            popup: toAnalyticsPopup(state.runtime.popup),
            amount: result.amount,
            currency: result.currency,
            products,
          })
          cart.clear()
        }

        set({ submitting: false })
        return {
          status: result.status,
          paymentId: result.payment_id,
          checkoutUrl: result.checkout_url,
          redirectUrl: result.redirect_url ?? null,
          amount: result.amount,
          currency: result.currency,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Payment failed"
        set({ submitting: false, error: message })
        throw err
      }
    },
    dispose() {
      pricing.dispose()
      cart.dispose()
      listeners.clear()
    },
  }
}
