// The orchestration brain: a minimal framework-agnostic store that wires the
// catalogue + selection + order assembly + pricing (server-authoritative) +
// cart persistence + analytics into one subscribe/getState/action surface. The
// React adapter is a thin bridge over this. No React here.
//
// Screens and navigation are deliberately absent: a client builds its own
// checkout, so which screen it shows, and when, is its own business. The store
// answers what is for sale, what is selected, what it costs, and how to pay.

import type { AnalyticsBus } from "../analytics/bus"
import type { AnalyticsPopup, AnalyticsProduct } from "../analytics/events"
import type { CheckoutClient } from "../client"
import { type CartDriver, type CartMeta, createCartDriver } from "../cart/driver"
import { isBuyerComplete, stripCustomPrefix, toBuyerInfo } from "../form/buyer"
import { buildFormZodSchema } from "../form/schema"
import { buildOrderLines } from "../order/buildOrderLines"
import {
  createPricingDriver,
  type PricingDriver,
  type PricingState,
} from "../pricing/driver"
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
} from "../selection/state"
import type {
  CheckoutProduct,
  PaymentRecipientRequest,
  ProductLine,
} from "../types/api"
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
  /** The popup's catalogue. Empty until `load()` resolves. */
  products: CheckoutProduct[]
  /** The buyer form to render and validate against. */
  formSchema: ApplicationFormSchema | null
  /** True once the catalogue and form have loaded at least once. */
  loaded: boolean
  /**
   * Whether the buyer values satisfy the form. Enable your pay button on this:
   * /purchase refuses a buyer missing a required field, and the SDK no longer
   * gates that behind a step of its own.
   */
  buyerComplete: boolean
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
  /** Seed the catalogue to avoid a fetch (SSR, an already-bootstrapped page). */
  products?: CheckoutProduct[]
  /** Seed the buyer form the same way. */
  formSchema?: ApplicationFormSchema | null
  /** Popup slug, used only to label analytics events. */
  popupSlug?: string
  analytics?: AnalyticsBus
  pricingDebounceMs?: number
  cartDebounceMs?: number
}

export interface CheckoutStore {
  getState(): CheckoutStoreState
  subscribe(listener: (state: CheckoutStoreState) => void): () => void
  /** Fetch catalogue + buyer form (unless seeded) and emit ViewContent. */
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
  submit(): Promise<SubmitResult>
  dispose(): void
  /** True once dispose() has run. A disposed store must be rebuilt, not reused. */
  isDisposed(): boolean
}

/**
 * The recipient key the store buys under. Every ticket line needs one: the API
 * refuses a ticket that names nobody, since a ticket is always somebody's. A
 * checkout that sells tickets for other people sends its own recipients and
 * uses the client directly.
 */
const BUYER_RECIPIENT_KEY = "buyer"

/**
 * The three fields /purchase always demands, whatever the form says.
 *
 * `form_schema.base_fields` is empty for a popup whose operator never
 * configured the base questions, but `BuyerInfo` still requires these, so a
 * checkout that trusted the schema alone would collect no email and fail at
 * payment with a 422 it could not explain.
 */
const ALWAYS_REQUIRED_BASE = ["email", "first_name", "last_name"] as const

function isTicket(product: CheckoutProduct | undefined): boolean {
  return (product?.category ?? "").toLowerCase() === "ticket"
}

function toAnalyticsProduct(p: CheckoutProduct): AnalyticsProduct {
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
  let disposed = false

  const pricing: PricingDriver = createPricingDriver({
    client,
    debounceMs: config.pricingDebounceMs,
  })
  const cart: CartDriver = createCartDriver({
    client,
    debounceMs: config.cartDebounceMs,
  })

  let state: CheckoutStoreState = {
    products: config.products ?? [],
    formSchema: config.formSchema ?? null,
    buyerComplete: false,
    loaded: config.products !== undefined && config.formSchema !== undefined,
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

  function productById(id: string): CheckoutProduct | undefined {
    return state.products.find((p) => p.id === id)
  }

  /** Who an analytics event is about. The catalogue carries the popup id. */
  function analyticsPopup(): AnalyticsPopup {
    const first = state.products[0]
    return {
      id: first?.popup_id ?? "",
      slug: config.popupSlug ?? "",
      name: null,
      currency: first?.currency ?? null,
    }
  }

  function buyerEmail(): string {
    return String(state.buyer.values.email ?? "")
  }

  function isBuyerFilled(): boolean {
    const v = state.buyer.values
    const hasBase = ALWAYS_REQUIRED_BASE.every((name) =>
      Boolean(String(v[name] ?? "").trim()),
    )
    if (!hasBase) return false
    if (state.formSchema)
      return isBuyerComplete(buildFormZodSchema(state.formSchema), v)
    return true
  }

  /** A schema is only usable once it carries the fields the builder expects. */
  function asFormSchema(raw: unknown): ApplicationFormSchema | null {
    return raw && typeof raw === "object" && "base_fields" in raw
      ? (raw as ApplicationFormSchema)
      : null
  }

  // Re-price + persist whenever the selection or coupon or insurance changes.
  function refreshDerived() {
    pricing.update({
      products: buildOrderLines(state.selection),
      couponCode: state.coupon.valid ? state.coupon.code : null,
      insurance: state.selection.insurance,
    })
    const email = buyerEmail()
    if (email) cart.save(email, state.selection)
  }

  function commitSelection(next: SelectionState) {
    set({ selection: next })
    refreshDerived()
  }

  function doSetQuantity(productId: string, quantity: number) {
    const prev = state.selection.quantities[productId] ?? 0
    commitSelection(setQuantityFn(state.selection, productId, quantity))
    const added = quantity - prev
    if (added > 0 && analytics) {
      const product = productById(productId)
      if (product) {
        analytics.addToCart(analyticsPopup(), toAnalyticsProduct(product), added)
      }
    }
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
      try {
        // Two independent reads, so they go out together. A seeded half costs
        // nothing; only the missing one is fetched.
        const [products, formSchema] = await Promise.all([
          config.products !== undefined
            ? config.products
            : client.getProducts().then((res) => res.products),
          config.formSchema !== undefined
            ? config.formSchema
            : client.getForm().then((res) => asFormSchema(res.form_schema)),
        ])
        set({ products, formSchema, loaded: true, error: null })
        set({ buyerComplete: isBuyerFilled() })
        analytics?.viewContent(analyticsPopup(), products.map(toAnalyticsProduct))
      } catch (err) {
        // Report it BOTH ways: through state, so a UI that never awaited this
        // (the React provider calls it for you) can still show a retry screen
        // instead of an empty catalogue that looks like a sold-out event; and
        // by rethrowing, so a caller that did await it is not left guessing.
        set({ error: err instanceof Error ? err.message : "Checkout unavailable" })
        throw err
      }
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
      set({ buyerComplete: isBuyerFilled() })
    },
    async submit() {
      if (state.submitting) throw new Error("Payment already in progress")
      const lines = buildOrderLines(state.selection)
      if (lines.length === 0) throw new Error("Nothing selected")
      set({ submitting: true, error: null })

      try {
        const email = buyerEmail()
        // Flush the cart first so cid/sig continuity proof is fresh.
        const meta = email
          ? await cart.flush(email, state.selection)
          : cart.getMeta()
        set({ cartMeta: meta })

        const v = state.buyer.values
        const firstName = String(v.first_name ?? "")
        const lastName = String(v.last_name ?? "")
        const products: ProductLine[] = lines.map((line) =>
          isTicket(productById(line.product_id))
            ? { ...line, recipient_key: BUYER_RECIPIENT_KEY }
            : line,
        )
        const recipients: PaymentRecipientRequest[] = products.some(
          (line) => line.recipient_key === BUYER_RECIPIENT_KEY,
        )
          ? [
              {
                recipient_key: BUYER_RECIPIENT_KEY,
                name: `${firstName} ${lastName}`.trim() || email,
                email,
                profile_snapshot: stripCustomPrefix(v),
              },
            ]
          : []
        const result = await client.purchase({
          products,
          recipients,
          buyer: toBuyerInfo({
            email,
            firstName,
            lastName,
            formData: v,
          }),
          coupon_code: state.coupon.valid ? state.coupon.code : null,
          insurance: state.selection.insurance || undefined,
          cid: meta.cartId,
          sig: meta.restoreToken,
        })

        if (result.status === "approved" && analytics) {
          analytics.purchase({
            paymentId: result.payment_id,
            popup: analyticsPopup(),
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
      if (disposed) return
      disposed = true
      pricing.dispose()
      cart.dispose()
      listeners.clear()
    },
    isDisposed() {
      return disposed
    },
  }
}
