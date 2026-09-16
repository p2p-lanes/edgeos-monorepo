---
name: building-edgeos-checkout
description: Use when building a custom-styled checkout UI on top of the EdgeOS headless checkout SDK (@edgeos/checkout-core, framework-agnostic — or @edgeos/checkout-react for React) — wiring products, cart quantities, server-authoritative pricing, buyer forms, coupons, and the SimpleFi payment redirect with a publishable key. Covers the exact store/API/hook contract, money-as-strings, the submit→redirect flow, and the custom_ buyer-field prefix. Works for React, Vue, Svelte, or vanilla JS.
---

# Building an EdgeOS Custom Checkout

## Overview

EdgeOS is **headless commerce**: all checkout logic (catalog, cart, pricing math,
step flow, buyer-form validation, coupons, payment handoff) lives in the SDK. You
build **only the UI** — your own components, your own styles, in **any framework
or none**. You never touch card data, never compute prices, never talk to the
payment provider directly.

Two packages, one engine:

- **`@edgeos/checkout-core`** — the framework-agnostic engine. A `store` with
  `subscribe` / `getState` / actions, a typed API client, and pure
  form/pricing/cart helpers. **Zero React** — use it from Vue, Svelte, Solid,
  Angular, web components, or plain JS.
- **`@edgeos/checkout-react`** — a thin React adapter (`<CheckoutProvider>` +
  hooks) over the exact same store. It **re-exports everything in core**, so a
  React app installs only this one package.

**The path you take depends on your framework:**

| You use… | Install | Read | Primary path |
|---|---|---|---|
| React | `@edgeos/checkout-react` | this file + **`hooks-reference.md`** | `<CheckoutProvider>` + hooks |
| Vue / Svelte / vanilla / anything else | `@edgeos/checkout-core` | this file + **`core-store-reference.md`** | the `store` (subscribe/getState/actions) |

Everything else in this skill — `api-contract.md`, the money/step/buyer rules
below, the examples — applies **identically to both paths**. The React hooks are
just selectors over the same store; the contract is the same.

**The one rule that governs everything: money is the API's job, orchestration is
the SDK's job, and pixels are yours.** You render what the store/hooks give you;
you never do arithmetic on prices.

## What you were given

To integrate you need just **two** things:

| Value | Example | Where it goes | Where it comes from |
|---|---|---|---|
| Publishable key | `pk_live_xxxxxxxx` | sent as the `X-EdgeOS-Publishable-Key` header | You generate it in the EdgeOS backoffice → your Organization → *Checkout SDK Keys* |
| Popup slug | `amanita` | identifies your popup/event | Visible in the backoffice |
| Sales flow slug | `checkout` | identifies the checkout flow | Visible in the backoffice |

You do **not** need an API URL: the SDK targets the EdgeOS production API by
default (`DEFAULT_BASE_URL`). There is an optional `baseUrl`, but you only set it
if EdgeOS tells you to point at a non-prod environment (dev/staging) or you route
calls through your own proxy — see *Pointing at a different environment* below.

The publishable key is **browser-safe** (not a secret) but is locked to an
**origin allowlist by host**. Requests from an origin not on the list get `403`.
Your deployed origin must be added to the key by the operator, and CORS must
allow it. During local dev, `localhost` is typically allowed.

## Quick start — framework-agnostic (the core store)

This is the path for **Vue, Svelte, vanilla JS, or any non-React UI**. Full
reference: **`core-store-reference.md`**. A complete runnable example with no
framework: **`example-vanilla.ts`**.

```ts
import { createCheckoutClient, createCheckoutStore } from "@edgeos/checkout-core"

const client = createCheckoutClient({ slug: "amanita", flowSlug: "checkout", publishableKey: "pk_live_xxxxxxxx" })
const store = createCheckoutStore({ client })

// 1. Subscribe — your render function runs on every state change.
const unsubscribe = store.subscribe((state) => {
  render(state)   // read state.runtime / selection / pricing / buyer / currentStep
})

// 2. Load the catalog + form + steps.
await store.load()

// 3. Drive it from your UI event handlers:
store.setQuantity(productId, 2)        // → debounced authoritative /preview
store.setBuyer({ email, first_name, last_name, custom_phone })
const result = await store.submit()    // → { checkoutUrl } — you redirect there

// 4. On teardown:
unsubscribe()
store.dispose()
```

## Quick start — React (the adapter)

This is the path for **React**. Full reference: **`hooks-reference.md`**. A
complete restyle-me component: **`example-checkout.tsx`**.

```tsx
import { CheckoutProvider, useCheckout, useCart, usePreview } from "@edgeos/checkout-react"

export function App() {
  return (
    <CheckoutProvider slug="amanita" flowSlug="checkout" publishableKey="pk_live_xxxxxxxx">
      <YourCheckout />
    </CheckoutProvider>
  )
}

function YourCheckout() {
  const { runtime, submit } = useCheckout()
  const { quantities, setQuantity } = useCart()
  const { total } = usePreview()        // server-authoritative, money as a string
  // …render runtime.products, steppers, total, buyer form, then:
  // const { checkoutUrl } = await submit(); window.location.assign(checkoutUrl)
}
```

`<CheckoutProvider>` builds the store once and, by default (`autoLoad`), calls
`GET /checkout/{slug}/{flowSlug}/runtime` on mount. The hooks are thin live subscriptions
over that store — components re-render on relevant state changes.

### Pointing at a different environment

`baseUrl` defaults to the EdgeOS production API. Override it **only** when told
to — e.g. testing against a local/staging backend, or proxying through your own
domain. It must be the API root **including `/api/v1`** and **excluding the slug**:

```ts
// core:
createCheckoutClient({ slug: "amanita", flowSlug: "checkout", publishableKey: "pk_live_xxx", baseUrl: "http://localhost:8000/api/v1" })
// react:
// <CheckoutProvider slug="amanita" flowSlug="checkout" publishableKey="pk_live_xxx" baseUrl="http://localhost:8000/api/v1">
```

## The store surface (both paths)

Whether you call these directly (core) or through hooks (React), the actions and
state are the same. The store exposes `getState()`, `subscribe(listener)`, and:

| Action | Does |
|---|---|
| `load()` | fetch runtime (catalog + form + steps) |
| `setQuantity(id, n)` | set exact quantity (0 removes); steppers |
| `selectProduct(id)` | TOGGLE 0↔1; pick-one cards |
| `selectHousing(input)` / `setHousingQuantity(n)` / `clearHousing()` | housing (date ranges) |
| `setInsurance(bool)` | insurance toggle |
| `setBuyer(patch)` | shallow-merge buyer values (see `custom_` rule) |
| `applyCoupon(code)` / `clearCoupon()` | coupon (reprices; resolves `false` if invalid, never throws) |
| `goToStep(step)` / `nextStep()` / `previousStep()` | navigation (`goToStep` returns `false` if unreachable) |
| `submit()` | create the payment → `SubmitResult` (see below) |
| `dispose()` / `isDisposed()` | teardown; a disposed store must be rebuilt, not reused |

`getState()` returns `CheckoutStoreState`:
`{ runtime, steps, currentStep, selection, buyer, coupon, pricing, cartMeta, submitting, error }`.
The React hooks just select slices of this.

## Critical contract facts (read before writing UI)

These are the non-obvious things that **will bite you** if you guess. They apply
to **both paths**. Full detail in **`api-contract.md`**; the essentials:

1. **Money is always a decimal string** (`"498000.00"`), never a JS number.
   **Never `parseFloat` an authoritative amount** — render it verbatim (float drift
   corrupts totals). Format for display only if you keep the string authoritative.

2. **Price breakdown field names are tricky.** From the preview
   (`state.pricing.preview` / `usePreview().preview`):
   - `total` — what the buyer is charged. Show this.
   - `discount_amount` — the amount **saved** by the coupon → this is your "You saved X".
   - `discountable_amount` — the discountable portion **AFTER** discount (net). **Not** a subtotal. Don't show it as "subtotal".
   - There is **no pre-discount subtotal field**, and you can't sum lines yourself (no parsing). Per-line `line_total` is gross (pre-discount).
   - Zero serializes as `"0.00"`, not `"0"` — compare with care (see api-contract.md).

3. **Buyer fields: the `custom_` prefix is mandatory.** Only `email`,
   `first_name`, `last_name` are stored raw. **Every other field** (phone, custom
   questions, dietary, etc.) must be set with a `custom_` prefix — e.g.
   `setBuyer({ custom_phone: "..." })`. The core strips the prefix into the API's
   `form_data`. **A non-prefixed field other than the three named ones is silently
   dropped and never reaches the backend.**

4. **Submit returns a redirect, it does not "complete" the order.**
   `await submit()` → `SubmitResult { status, checkoutUrl, redirectUrl, ... }`:
   - **Paid order:** `status === "pending"`, `checkoutUrl` = the SimpleFi hosted
     pay page → **redirect the browser to `checkoutUrl`**. Payment finishes there.
   - **Zero-amount order** (100% coupon / free): `status === "approved"`,
     `checkoutUrl` empty; `redirectUrl` may hold a custom success URL → send them
     there, else show your own success screen.
   - `status` ∈ `pending | approved | rejected | expired | cancelled`.
   - Precedence: `if (checkoutUrl) → checkoutUrl; else if (redirectUrl) → redirectUrl; else → your success page`.

5. **Pricing is server-computed and debounced.** After any cart/coupon change,
   `state.pricing.status` (`usePreview().status`) goes `"loading"` then settles.
   `total` is `null` when the cart is empty. Gate your "Pay/Continue" button on
   `preview.total !== null`.

6. **Runtime load has no built-in error state.** `runtime === null` means
   "loading **or** failed" — the store/provider swallows the fetch error. If you
   need to distinguish (retry UI), **prefetch the runtime yourself** with
   `client.getRuntime()` and seed it (`initialRuntime` in React, or just render
   from your own fetch in core). Patterns in `core-store-reference.md` /
   `hooks-reference.md`.

## Client-side buyer validation (optional but recommended)

The core ships the exact same Zod validator the EdgeOS portal uses, so you can
validate before submit instead of round-tripping to a `422`:

```ts
import { buildFormZodSchema, validateBuyerValues } from "@edgeos/checkout-core"
// (also re-exported from @edgeos/checkout-react)

const schema = buildFormZodSchema(runtime.form_schema)          // form_schema from runtime
const { valid, errors } = validateBuyerValues(schema, values)   // errors: field → message
```

## Common mistakes

| Mistake | Fix |
|---|---|
| `parseFloat(preview.total)` for display math | Keep money as the string; never parse authoritative amounts |
| Showing `discountable_amount` as "subtotal" | It's post-discount net; use `discount_amount` for savings, `total` for the charge |
| Storing `phone` as `setBuyer({ phone })` | Custom fields need the prefix: `setBuyer({ custom_phone })` |
| Treating `submit()` as "order done" | It returns a `checkoutUrl` — you must redirect to it |
| Reusing a disposed store | After `dispose()`, `isDisposed()` is true — build a new store |
| Spinner forever because `runtime` is null | A failed `/runtime` looks identical to loading — prefetch to detect errors |
| Setting `baseUrl` when you don't need to | Leave it unset — it defaults to prod. Only override for dev/staging/proxy |
| Overridden `baseUrl` includes the slug, or omits `/api/v1` | When you do override, it's the API root **with** `/api/v1`, **without** the slug |
| Changing `slug`/`key` after load | The store binds them once; build a new store (React: remount with `key={slug}`) to switch popups |
| `403` on every call in production | Your origin isn't on the key's allowlist — ask the operator to add it |

## Reference files in this folder

- **`api-contract.md`** — endpoints, every response field, money/status semantics, error codes. **Framework-agnostic — read this regardless of your stack.**
- **`core-store-reference.md`** — the framework-agnostic store: client, `createCheckoutStore`, every action, subscribe/getState, the load-error pattern, analytics. **The primary reference for non-React UIs.**
- **`example-vanilla.ts`** — one complete integration with **no framework** (plain DOM). Copy and adapt to Vue/Svelte/etc.
- **`hooks-reference.md`** — the React adapter: `<CheckoutProvider>` + every hook, full signatures, gotchas. **React only.**
- **`example-checkout.tsx`** — one complete, type-correct, restyle-me **React** integration.

## Scope note

This skill covers the common single-page ticket checkout (products + quantities +
buyer + coupon + pay). The SDK also supports housing (date ranges), an insurance
toggle, multi-step flows from `runtime.ticketing_steps`, cart persistence/restore,
and analytics adapters (Meta Pixel / GA). Those are in the reference files —
reach for them when the popup uses those features.
