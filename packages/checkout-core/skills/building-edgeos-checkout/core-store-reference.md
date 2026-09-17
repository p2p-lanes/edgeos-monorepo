# EdgeOS Checkout — Core Store Reference (framework-agnostic)

Everything here is exported from **`@edgeos/checkout-core`** and works in **any**
framework or none (Vue, Svelte, Solid, Angular, web components, vanilla JS). This
is the primary reference for non-React UIs. Using React? Use
**`@edgeos/checkout-react`** and read `hooks-reference.md` instead — it wraps this
exact store in a provider + hooks.

The mental model: build a **client** (the API boundary), build a **store** (the
orchestration brain) from it, `subscribe` to state, call **actions** from your UI
event handlers, render from `getState()`. The store owns catalogue/cart/pricing/buyer
and drives the debounced authoritative `/preview` for you. **Screens and navigation
are deliberately absent**: which screen you show, and when, is your app's own
state.

## 1. The client — `createCheckoutClient`

```ts
import { createCheckoutClient } from "@edgeos/checkout-core"

const client = createCheckoutClient({
  slug: "amanita",                 // your popup slug
  publishableKey: "pk_live_xxxx",  // → X-EdgeOS-Publishable-Key header
  baseUrl: undefined,              // OPTIONAL — defaults to the EdgeOS prod API
                                   // (DEFAULT_BASE_URL). Override for dev/staging/
                                   // proxy: API root incl. /api/v1, WITHOUT the slug
  // fetch: customFetch,           // OPTIONAL — inject fetch (SSR / tests)
})
```

`CheckoutClientOptions = { slug: string; baseUrl?: string; publishableKey?: string; fetch?: typeof fetch }`.

**No `flowSlug`.** Sales flows are EdgeOS's own concept: the client resolves the
popup's primary flow once via `GET /checkout/{slug}/primary` (memoized, and
retried after a failure) and spends it on preview/purchase/cart.

The `CheckoutClient` is a typed wrapper over the API. You rarely call it directly
(the store composes it), but it's there for prefetch, SSR, or bespoke flows:

```ts
client.getProducts()                   // GET  /checkout/{slug}/products → { products }, the whole active catalogue
client.getForm()                       // GET  /checkout/{slug}/form     → { form_schema }, the primary flow's buyer form
client.getPrimaryFlow()                // GET  /checkout/{slug}/primary  → the flow slug the rest run through
client.preview(body)                   // POST /checkout/{slug}/{primary}/preview  → authoritative breakdown
client.validateCoupon(code)            // POST coupon validation
client.purchase(body)                  // POST /checkout/{slug}/{primary}/purchase → pay URL
client.upsertCart(body)                // PUT  /checkout/{slug}/{primary}/cart     → persist anon cart by email
client.restoreCart(cid, sig)           // GET  /checkout/{slug}/{primary}/cart?cid&sig → restore from signed link
```

`getProducts()` and `getForm()` **require the publishable key**: without it they
answer `401`. The catalogue is the popup's whole active one (ticketing steps
ignored, accommodation shadow products excluded); grouping it into screens is
your job.

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
  products,                  // OPTIONAL. Seed the catalogue to skip that load() fetch
  formSchema,                // OPTIONAL. Seed the buyer form the same way
  popupSlug,                 // OPTIONAL. Labels analytics events only
  analytics,                 // OPTIONAL — an AnalyticsBus (Meta Pixel / GA); see below
  pricingDebounceMs,         // OPTIONAL — debounce before /preview fires
  cartDebounceMs,            // OPTIONAL — debounce before the cart is persisted
})
```

The two seeds are independent: `load()` fetches only the half you didn't seed.
`loaded` starts `true` only when **both** were supplied (`formSchema: null`
counts as supplied).

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
  products: CheckoutProduct[]                // the catalogue; empty until load() resolves
  formSchema: ApplicationFormSchema | null   // the buyer form to render and validate
  loaded: boolean                            // true once catalogue + form loaded at least once
  selection: SelectionState                  // quantities, housing, insurance
  buyer: BuyerState                          // buyer values (email/first/last + custom_*)
  coupon: CouponState                        // { code: string | null; valid: boolean }
  pricing: PricingState                      // { status, preview, error } — the price lives here
  cartMeta: CartMeta                         // anon-cart persistence metadata
  submitting: boolean
  error: string | null                       // last submit error message
}
```

There is **no `steps` / `currentStep`** and no step module: `deriveAvailableSteps`,
`canProceedToStep`, `toCheckoutStep` and the `CheckoutStep` type are all gone.
Keep the current screen in your own state (see `example-vanilla.ts`).

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
await store.load()                       // fetch catalogue + buyer form (skips whichever you seeded)
                                         // REJECTS if a fetch fails: try/catch it (see §5)

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

`submit()` also assembles the **recipients** the API requires: every line whose
product `category` is `"ticket"` is stamped `recipient_key: "buyer"` and one
`recipients` entry is sent for the buyer (`name`, `email`, and a
`profile_snapshot` of their form values with the `custom_` prefix stripped).
Non-ticket lines get no recipient, and with no ticket in the cart `recipients` is
`[]`. Selling tickets for **other** people means building `products` +
`recipients` yourself and calling `client.purchase()` directly.

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

## 5. Handling a failed load

`store.load()` **rejects** if the catalogue or the buyer form fails to fetch. It
also records the failure in `state.error` and leaves `state.loaded` at `false`,
so a UI that never awaited it still knows. Check `state.error` before you read an
empty `state.products`: an empty catalogue and a failed fetch look identical
otherwise, and one of them is a sold-out event. Await it when you can:

```ts
const store = createCheckoutStore({ client })
store.subscribe(render)
try {
  await store.load()
} catch {
  showRetryScreen()        // a real error state, distinct from "still loading"
  return
}
```

Prefetching works too, and lets you own the whole fetch (SSR, a page that already
bootstrapped its catalogue):

```ts
const [{ products }, { form_schema }] = await Promise.all([
  client.getProducts(),
  client.getForm(),
])
const store = createCheckoutStore({
  client,
  products,
  formSchema: form_schema as ApplicationFormSchema,
})                                          // both seeded → no load() needed
store.subscribe(render)
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

// state.formSchema is null until load() resolves, so guard before building.
if (state.formSchema) {
  const schema = buildFormZodSchema(state.formSchema)
  const { valid, errors } = validateBuyerValues(schema, state.buyer.values) // errors: field → message
}
```

---

See **`example-vanilla.ts`** in this folder for a complete, no-framework
integration wiring all of the above to plain DOM. Adapt its shape to Vue's
`onMounted`/`reactive`, Svelte's stores, etc. — the store contract is identical.
