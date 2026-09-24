# EdgeOS Checkout — React Hooks & Provider Reference

**React only.** Not using React? Read **`core-store-reference.md`** instead — it
documents the same store this adapter wraps, for Vue/Svelte/vanilla/etc.

Everything here is exported from `@edgeos/checkout-react` (which re-exports all of
`@edgeos/checkout-core`). The hooks are thin selectors over the framework-agnostic
store built by `<CheckoutProvider>`; the store actions they expose are stable
(safe in deps / event handlers).

## `<CheckoutProvider>`

```tsx
interface CheckoutProviderProps {
  children: ReactNode
  // Build a client from these (the common case):
  slug?: string             // popup slug. NO flow slug: the client resolves the primary flow
  publishableKey?: string   // → X-EdgeOS-Publishable-Key header
  baseUrl?: string          // OPTIONAL — defaults to the EdgeOS prod API
                            // (DEFAULT_BASE_URL). Override for dev/staging/proxy;
                            // then: API root incl. /api/v1, WITHOUT the slug
  // Advanced / injection:
  store?: CheckoutStore          // adopt a pre-built store (you own its lifecycle)
  client?: CheckoutClient        // adopt a pre-built API client
  transport?: Transport          // custom HTTP boundary (SSR, tests, auth)
  initialProducts?: CheckoutProduct[]                // seed the catalogue, skip that fetch
  initialFormSchema?: ApplicationFormSchema | null   // seed the buyer form the same way
  analytics?: AnalyticsBus       // Meta Pixel / GA adapter
  autoLoad?: boolean             // default true → store.load() on mount
}
```

Lifecycle facts:
- The store is built **exactly once**, on first render. **Changing `slug` /
  `baseUrl` / `publishableKey` props after mount has no effect.** To switch
  popups, remount with a `key` that includes the slug.
- `autoLoad` (default) fetches the catalogue and the buyer form on mount. If you
  pass both seeds, set `autoLoad={false}` to avoid a double fetch.
- A store the provider built is disposed on unmount; a `store` you passed in is left alone.
- **StrictMode:** React runs cleanup→setup on the same instance, which would leave
  the subtree pointed at a store the cleanup already disposed (blank total, no
  cart). The provider detects that and **rebuilds a fresh store** before loading,
  so you need no workaround, but don't be surprised that an internally-built
  store is constructed twice in dev.

## Hooks

### `useCheckout()`
```ts
{
  products: CheckoutProduct[]               // the popup's whole active catalogue
  formSchema: ApplicationFormSchema | null  // the buyer form to render/validate
  loaded: boolean                           // false = loading OR failed (see below)
  submitting: boolean
  error: string | null                      // last submit error message
  submit(): Promise<SubmitResult>           // creates payment; see below
}
```

**No step navigation.** `useSteps` is gone, and so are `steps`, `currentStep`,
`goToStep`, `nextStep` and `previousStep`. Which screen is showing is your own
`useState`; see `example-checkout.tsx`.

`submit()` resolves to:
```ts
interface SubmitResult {
  status: string        // pending | approved | rejected | expired | cancelled
  paymentId: string
  checkoutUrl: string   // redirect here to pay (empty for zero-amount)
  redirectUrl: string | null
  amount: string        // Money
  currency: string
}
```
It **rejects** on network / 4xx / 5xx — always `try/catch`. On reject,
`useCheckout().error` is set. It throws synchronously if the cart is empty
(`"Nothing selected"`) or a submit is already running.

`submit()` also fills in the **recipients** the API demands for ticket products:
each line whose product `category` is `"ticket"` gets `recipient_key: "buyer"`,
and one recipient is sent for the buyer (name, email, `profile_snapshot`). See
`api-contract.md` → *Recipients* for selling to other people.

### `useCart()`
```ts
{
  selection: SelectionState        // full raw selection (quantities, housing, insurance)
  quantities: Record<string, number>
  housing: ...                     // set housing selection state
  insurance: boolean
  setQuantity(productId, quantity): void   // set exact quantity (0 removes)
  selectProduct(productId): void           // TOGGLE 0↔1 (use for single-select cards)
  selectHousing(input): void; setHousingQuantity(n): void; clearHousing(): void
  setInsurance(insurance: boolean): void
}
```
- Use `setQuantity` for steppers (multi-quantity products); `selectProduct` for
  pick-one card UIs (it flips between 0 and 1).
- Totals do **not** live here — always read `usePreview()`.

### `usePreview()`
```ts
{
  status: PricingStatus            // "idle" | "loading" | "success" | "error"
  preview: CheckoutPreviewResponse | null
  total: string | null             // convenience: preview?.total ?? null
  error: CheckoutApiError | Error | null   // an Error, NOT a string: render error.message
}
```
- Debounced: after a cart/coupon change, `status` briefly = `"loading"`, then
  `"success"`. Show a subtle "updating…" state, not a full spinner.
- `total === null` when the cart is empty → disable Pay/Continue.
- On a preview error the previous `preview` is kept (stale) and `error` is set;
  decide whether to keep showing the stale total or block. Note the shape
  differs from `useCheckout().error`, which is a plain string: this one is the
  thrown error, so a `CheckoutApiError` still carries its `status`.

### `useBuyerForm()`
```ts
{
  values: Record<string, unknown>          // base fields raw; custom fields as custom_<key>
  setBuyer(patch: Record<string, unknown>): void   // shallow-merges the patch
  coupon: { code: string | null; valid: boolean }
  applyCoupon(code: string): Promise<boolean>      // validates + reprices; false if invalid (never rejects)
  clearCoupon(): void
}
```
- Store `email` / `first_name` / `last_name` raw; **all other fields must be
  `custom_`-prefixed** (see api-contract.md → buyer form). e.g.
  `setBuyer({ custom_phone: "+54..." })`.
- `applyCoupon` resolves `false` for an invalid code (it never throws); a valid
  coupon may still yield no discount until `/preview` reflects it.

### `useCheckoutState()`
Returns the entire `CheckoutStoreState` (escape hatch for advanced cases):
```ts
interface CheckoutStoreState {
  products, formSchema, loaded, selection, buyer, coupon, pricing, cartMeta, submitting, error
}
```

## Detecting a failed load

`<CheckoutProvider autoLoad>` calls `load()` for you, so you never see its
rejection. Read `useCheckout().error` instead: the store records the failure
there and leaves `loaded` at `false`, which is how you tell "still loading" from
"failed". Prefetching is still an option when you want to own the fetch itself
(SSR, or a page that already has the catalogue):

```tsx
import {
  type ApplicationFormSchema,
  type CheckoutProduct,
  CheckoutProvider,
  createCheckoutClient,
} from "@edgeos/checkout-react"
import { useEffect, useState } from "react"

const client = createCheckoutClient({
  slug: "amanita",
  baseUrl: "https://api.example/api/v1",
  publishableKey: "pk_live_xxx",
})

export function Boot() {
  const [boot, setBoot] = useState<{
    products: CheckoutProduct[]
    formSchema: ApplicationFormSchema | null
  } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([client.getProducts(), client.getForm()])
      .then(([p, f]) => {
        if (!alive) return
        setBoot({
          products: p.products,
          formSchema: f.form_schema as unknown as ApplicationFormSchema,
        })
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (failed) return <RetryScreen />
  if (!boot) return <LoadingScreen />

  return (
    <CheckoutProvider
      client={client}
      initialProducts={boot.products}
      initialFormSchema={boot.formSchema}
      autoLoad={false}
    >
      <YourCheckout />
    </CheckoutProvider>
  )
}
```

## Using the API client directly

`createCheckoutClient({ slug, baseUrl, publishableKey })` → a typed `CheckoutClient`:
`getProducts()`, `getForm()`, `getPrimaryFlow()`, `preview(body)`,
`validateCoupon(code)`, `purchase(body)`, `upsertCart(body)`,
`restoreCart(cid, sig)`. No flow slug anywhere: the client resolves the popup's
primary flow once and uses it for preview/purchase/cart. Errors surface as
`CheckoutApiError` (also exported). You rarely need this — the store composes
these for you — but it's there for prefetch (above), SSR, or bespoke flows.

## Analytics adapters (optional)

The core emits a normalized event stream (ViewContent / AddToCart /
InitiateCheckout / Purchase). Ship parity with the EdgeOS portal by passing an
`analytics` bus to the provider:

```ts
import { createAnalyticsBus, createMetaPixelAdapter } from "@edgeos/checkout-react"

// Install the Meta Pixel base snippet yourself (sets window.fbq); the adapter
// reads window.fbq at call time — it does NOT take a pixelId.
const analytics = createAnalyticsBus([createMetaPixelAdapter()])
// <CheckoutProvider analytics={analytics} …>
```
`createGaAdapter(options)` is also exported. `createMetaPixelAdapter` options are
all injection points for testing/SSR (`fbq`, `sessionId`, `now`) — none required
in the browser.
