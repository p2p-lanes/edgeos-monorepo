# EdgeOS Checkout — Hooks & Store Reference

Everything here is exported from `@edgeos/checkout-react`. The hooks are thin
selectors over a framework-agnostic store built by `<CheckoutProvider>`; the
store actions they expose are stable (safe in deps / event handlers).

## `<CheckoutProvider>`

```tsx
interface CheckoutProviderProps {
  children: ReactNode
  // Build a client from these (the common case):
  slug?: string
  publishableKey?: string   // → X-EdgeOS-Publishable-Key header
  baseUrl?: string          // OPTIONAL — defaults to the EdgeOS prod API
                            // (DEFAULT_BASE_URL). Override for dev/staging/proxy;
                            // then: API root incl. /api/v1, WITHOUT the slug
  // Advanced / injection:
  store?: CheckoutStore          // adopt a pre-built store (you own its lifecycle)
  client?: CheckoutClient        // adopt a pre-built API client
  transport?: Transport          // custom HTTP boundary (SSR, tests, auth)
  initialRuntime?: CheckoutRuntimeResponse  // seed to skip the mount fetch
  analytics?: AnalyticsBus       // Meta Pixel / GA adapter
  autoLoad?: boolean             // default true → store.load() on mount
}
```

Lifecycle facts:
- The store is built **exactly once**, on first render. **Changing `slug` /
  `baseUrl` / `publishableKey` props after mount has no effect.** To switch
  popups, remount: `<CheckoutProvider key={slug} slug={slug} …>`.
- `autoLoad` (default) fetches runtime on mount. If you pass `initialRuntime`,
  set `autoLoad={false}` to avoid a double fetch.
- A store the provider built is disposed on unmount; a `store` you passed in is left alone.

## Hooks

### `useCheckout()`
```ts
{
  runtime: CheckoutRuntimeResponse | null   // null = loading OR failed (see below)
  currentStep: CheckoutStep
  steps: CheckoutStep[]
  submitting: boolean
  error: string | null                      // last submit error message
  goToStep(step): boolean                    // false if the step isn't reachable yet
  nextStep(): void
  previousStep(): void
  submit(): Promise<SubmitResult>            // creates payment; see below
}
```

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
  error: string | null
}
```
- Debounced: after a cart/coupon change, `status` briefly = `"loading"`, then
  `"success"`. Show a subtle "updating…" state, not a full spinner.
- `total === null` when the cart is empty → disable Pay/Continue.
- On a preview error the previous `preview` is kept (stale) and `error` is set;
  decide whether to keep showing the stale total or block.

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

### `useSteps()`
Navigation slice only: `{ steps, currentStep, goToStep, nextStep, previousStep }`.
Use when a component only drives step movement.

### `useCheckoutState()`
Returns the entire `CheckoutStoreState` (escape hatch for advanced cases):
```ts
interface CheckoutStoreState {
  runtime, steps, currentStep, selection, buyer, coupon, pricing, cartMeta, submitting, error
}
```

## Detecting a failed runtime load (the load-status gap)

`<CheckoutProvider autoLoad>` swallows the `load()` error, so `runtime === null`
can't tell "loading" from "failed". If you need retry/error UI, prefetch the
runtime yourself and seed it:

```tsx
import {
  CheckoutProvider,
  createCheckoutClient,
  type CheckoutRuntimeResponse,
} from "@edgeos/checkout-react"
import { useEffect, useState } from "react"

const client = createCheckoutClient({
  slug: "amanita",
  baseUrl: "https://api.example/api/v1",
  publishableKey: "pk_live_xxx",
})

export function Boot() {
  const [runtime, setRuntime] = useState<CheckoutRuntimeResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    client
      .getRuntime()
      .then((r) => alive && setRuntime(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (failed) return <RetryScreen />
  if (!runtime) return <LoadingScreen />

  return (
    <CheckoutProvider client={client} initialRuntime={runtime} autoLoad={false}>
      <YourCheckout />
    </CheckoutProvider>
  )
}
```

## Using the API client directly

`createCheckoutClient({ slug, baseUrl, publishableKey })` → a typed `CheckoutClient`:
`getRuntime()`, `preview(body)`, `validateCoupon(code)`, `purchase(body)`,
`upsertCart(body)`, `restoreCart(cid, sig)`. Errors surface as `CheckoutApiError`
(also exported). You rarely need this — the store composes these for you — but
it's there for prefetch (above), SSR, or bespoke flows.

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
