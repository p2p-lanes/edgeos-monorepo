# EdgeOS Checkout — Core Store Reference (framework-agnostic)

Everything here is exported from **`@edgeos/checkout-core`** and works in **any**
framework or none (Vue, Svelte, Solid, Angular, web components, vanilla JS). This
is the primary reference for non-React UIs. Using React? Use
**`@edgeos/checkout-react`** and read `hooks-reference.md` instead — it wraps this
exact store in a provider + hooks.

The mental model: build a **client** (the API boundary), build a **store** (the
orchestration brain) from it, `subscribe` to state, call **actions** from your UI
event handlers, render from `getState()`. The store owns cart/pricing/steps/buyer
and drives the debounced authoritative `/preview` for you.

## 1. The client — `createCheckoutClient`

```ts
import { createCheckoutClient } from "@edgeos/checkout-core"

const client = createCheckoutClient({
  slug: "amanita",                 // your popup slug
  flowSlug: "checkout",            // canonical sales flow slug
  publishableKey: "pk_live_xxxx",  // → X-EdgeOS-Publishable-Key header
  baseUrl: undefined,              // OPTIONAL — defaults to the EdgeOS prod API
                                   // (DEFAULT_BASE_URL). Override for dev/staging/
                                   // proxy: API root incl. /api/v1, WITHOUT the slug
  // fetch: customFetch,           // OPTIONAL — inject fetch (SSR / tests)
})
```

`CheckoutClientOptions = { slug: string; flowSlug: string; baseUrl?: string; publishableKey?: string; fetch?: typeof fetch }`.

The `CheckoutClient` is a typed wrapper over the API. You rarely call it directly
(the store composes it), but it's there for prefetch, SSR, or bespoke flows:

```ts
client.getRuntime()                    // GET  /checkout/{slug}/{flowSlug}/runtime  → catalog + form + steps
client.preview(body)                   // POST /checkout/{slug}/{flowSlug}/preview  → authoritative breakdown
client.validateCoupon(code)            // POST coupon validation
client.purchase(body)                  // POST /checkout/{slug}/{flowSlug}/purchase → pay URL
client.upsertCart(body)                // PUT  /checkout/{slug}/{flowSlug}/cart     → persist anon cart by email
client.restoreCart(cid, sig)           // GET  /checkout/{slug}/{flowSlug}/cart?cid&sig → restore from signed link
```

Errors surface as **`CheckoutApiError`** (exported) — has the HTTP status and the
backend error body. See `api-contract.md` for every request/response shape.

**Advanced — custom transport.** `createCheckoutClient(config, transport?)` takes
an optional second arg to fully replace the HTTP boundary (auth proxy, SSR,
tests). Build one with `createFetchTransport({ baseUrl, slug, publishableKey })`
or implement the `Transport` interface. Most integrations never need this.

## 2. The store — `createCheckoutStore`

```ts
import { createCheckoutStore } from "@edgeos/checkout-core"

const store = createCheckoutStore({
  client,                    // required
  runtime,                   // OPTIONAL — seed runtime to skip the load() fetch
  analytics,                 // OPTIONAL — an AnalyticsBus (Meta Pixel / GA); see below
  pricingDebounceMs,         // OPTIONAL — debounce before /preview fires
  cartDebounceMs,            // OPTIONAL — debounce before the cart is persisted
})
```

### Reading state

```ts
store.getState()   // → CheckoutStoreState, a snapshot

store.subscribe((state) => {
  // Called on EVERY state change. This is your render trigger.
  // Returns an unsubscribe function — call it on teardown.
})
```

`CheckoutStoreState`:

```ts
interface CheckoutStoreState {
  runtime: CheckoutRuntimeResponse | null   // null = loading OR failed (see §5)
  steps: CheckoutStep[]
  currentStep: CheckoutStep
  selection: SelectionState                 // quantities, housing, insurance
  buyer: BuyerState                          // buyer values (email/first/last + custom_*)
  coupon: CouponState                        // { code: string | null; valid: boolean }
  pricing: PricingState                      // { status, preview, error } — the price lives here
  cartMeta: CartMeta                         // anon-cart persistence metadata
  submitting: boolean
  error: string | null                       // last submit error message
}
```

**The price** is `state.pricing`:

```ts
interface PricingState {
  status: "idle" | "loading" | "success" | "error"
  preview: CheckoutPreviewResponse | null   // the authoritative breakdown; total = preview.total
  error: CheckoutApiError | Error | null
}
```

So the buyer's charge is `state.pricing.preview?.total` (a **string**, or
`undefined`/`null` when nothing is priced). See `api-contract.md` for every field
of `preview` (and the `discount_amount` vs `discountable_amount` trap).

### Actions

All actions are stable references (safe to bind to event handlers once). Cart and
coupon changes automatically schedule the debounced authoritative `/preview`.

```ts
await store.load()                       // fetch runtime (skip if you seeded `runtime`)

store.setQuantity(productId, n)          // exact quantity; 0 removes. For steppers.
store.selectProduct(productId)           // TOGGLE 0↔1. For pick-one cards.
store.selectHousing(input)               // housing (date ranges) — see api-contract.md
store.setHousingQuantity(n)
store.clearHousing()
store.setInsurance(boolean)              // insurance toggle

store.setBuyer({ email, first_name, last_name, custom_phone })  // shallow-merges
                                         // email/first_name/last_name raw; ALL else custom_-prefixed

await store.applyCoupon(code)            // validates + reprices; resolves false if invalid (never throws)
store.clearCoupon()

store.goToStep(step)                     // returns false if the step isn't reachable yet
store.nextStep()
store.previousStep()

const result = await store.submit()      // creates the payment; see §3. try/catch it.

store.dispose()                          // teardown: stops timers, releases subscriptions
store.isDisposed()                       // true once disposed — a disposed store must be REBUILT, not reused
```

## 3. Submitting — `submit()`

```ts
try {
  const result = await store.submit()    // SubmitResult
  // { status, paymentId, checkoutUrl, redirectUrl, amount, currency }
  if (result.checkoutUrl) {
    window.location.assign(result.checkoutUrl)   // paid order → SimpleFi pay page
  } else if (result.redirectUrl) {
    window.location.assign(result.redirectUrl)   // zero-amount w/ custom success URL
  } else {
    showYourSuccessScreen()                        // zero-amount, no custom URL
  }
} catch (err) {
  // network / 4xx / 5xx — store.getState().error is also set.
  // submit() throws synchronously if the cart is empty or a submit is already running.
}
```

`status` ∈ `pending | approved | rejected | expired | cancelled`. A paid order is
`pending` with a `checkoutUrl`; a free/100%-coupon order is `approved` with an
empty `checkoutUrl`. **`submit()` does not complete the order** — the buyer pays
on the redirected page.

## 4. Full teardown & rebuild

Bind the lifecycle to your component/page:

```ts
const store = createCheckoutStore({ client })
const unsubscribe = store.subscribe(render)
await store.load()

// …later, on unmount / route change:
unsubscribe()
store.dispose()
```

The store binds `slug` / `publishableKey` (via the client) **once**. To switch
popups, build a **new client + new store**. Never reuse a disposed store —
`isDisposed()` returns true and its pricing/cart subscriptions are dead.

## 5. Detecting a failed runtime load (the load-status gap)

`store.load()` catches its own fetch error, so `state.runtime === null` can't tell
"loading" from "failed". If you need retry/error UI, **prefetch with the client**
and seed the store, rendering your own loading/error states around it:

```ts
let runtime
try {
  runtime = await client.getRuntime()        // your own try/catch → real error state
} catch {
  showRetryScreen()
  return
}
const store = createCheckoutStore({ client, runtime })   // seeded → no double fetch
store.subscribe(render)
// no store.load() needed — runtime is already seeded
```

## 6. Analytics adapters (optional)

The core emits a normalized event stream (ViewContent / AddToCart /
InitiateCheckout / Purchase). Pass an `analytics` bus to the store to get parity
with the EdgeOS portal:

```ts
import { createAnalyticsBus, createMetaPixelAdapter, createGaAdapter } from "@edgeos/checkout-core"

// Install the Meta Pixel base snippet yourself (sets window.fbq); the adapter
// reads window.fbq at call time — it does NOT take a pixelId.
const analytics = createAnalyticsBus([createMetaPixelAdapter()])
const store = createCheckoutStore({ client, analytics })
```

`createMetaPixelAdapter` options (`fbq`, `sessionId`, `now`) are all injection
points for testing/SSR — none required in the browser. `createGaAdapter(options)`
is also exported.

## 7. Client-side buyer validation (optional)

Validate the buyer form before submit using the same Zod schema the EdgeOS portal
uses:

```ts
import { buildFormZodSchema, validateBuyerValues } from "@edgeos/checkout-core"

const schema = buildFormZodSchema(state.runtime.form_schema)
const { valid, errors } = validateBuyerValues(schema, state.buyer)  // errors: field → message
```

---

See **`example-vanilla.ts`** in this folder for a complete, no-framework
integration wiring all of the above to plain DOM. Adapt its shape to Vue's
`onMounted`/`reactive`, Svelte's stores, etc. — the store contract is identical.
