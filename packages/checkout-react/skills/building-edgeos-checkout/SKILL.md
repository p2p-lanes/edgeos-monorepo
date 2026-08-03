---
name: building-edgeos-checkout
description: Use when building a custom-styled checkout UI on top of the EdgeOS headless checkout SDK (@edgeos/checkout-core / @edgeos/checkout-react) — wiring products, cart quantities, server-authoritative pricing, buyer forms, coupons, and the SimpleFi payment redirect with a publishable key. Covers the exact API/hook contract, money-as-strings, the submit→redirect flow, and the custom_ buyer-field prefix.
---

# Building an EdgeOS Custom Checkout

## Overview

EdgeOS is **headless commerce**: all checkout logic (catalog, cart, pricing math,
step flow, buyer-form validation, coupons, payment handoff) lives in the SDK. You
build **only the UI** — your own components, your own styles. You never touch card
data, never compute prices, never talk to the payment provider directly.

Two packages:

- **`@edgeos/checkout-core`** — framework-agnostic engine (store, API client, types, form/pricing/cart helpers). Zero React.
- **`@edgeos/checkout-react`** — thin React adapter: a `<CheckoutProvider>` + hooks. It re-exports everything from core, so **import everything from `@edgeos/checkout-react`**.

**The one rule that governs everything: money is the API's job, orchestration is the core's job, and pixels are yours.** You render what the hooks give you; you never do arithmetic on prices.

## What you were given

To integrate you need just **two** things:

| Value | Example | Where it goes | Where it comes from |
|---|---|---|---|
| Publishable key | `pk_live_xxxxxxxx` | `publishableKey` prop → sent as the `X-EdgeOS-Publishable-Key` header | You generate it yourself in the EdgeOS backoffice → your Organization → *Checkout SDK Keys* |
| Popup slug | `amanita` | `slug` prop | The slug of your popup/event, visible in the backoffice |

You do **not** need an API URL: the SDK targets the EdgeOS production API by
default. There is an optional `baseUrl` prop, but you only set it if EdgeOS tells
you to point at a non-prod environment (dev/staging) or you route calls through
your own proxy — see *Pointing at a different environment* below.

The publishable key is **browser-safe** (not a secret) but is locked to an
**origin allowlist by host**. Requests from an origin not on the list get `403`.
Your deployed origin must be added to the key by the operator, and CORS must
allow it. During local dev, `localhost` is typically allowed.

## Quick start (boot the SDK)

```tsx
import { CheckoutProvider } from "@edgeos/checkout-react"

export function App() {
  return (
    <CheckoutProvider slug="amanita" publishableKey="pk_live_xxxxxxxx">
      <YourCheckout />
    </CheckoutProvider>
  )
}
```

### Pointing at a different environment

`baseUrl` defaults to the EdgeOS production API. Override it **only** when told
to — e.g. testing against a local/staging backend, or proxying through your own
domain. It must be the API root **including `/api/v1`** and **excluding the slug**:

```tsx
// Local dev against a backend on your machine:
<CheckoutProvider
  slug="amanita"
  publishableKey="pk_live_xxxxxxxx"
  baseUrl="http://localhost:8000/api/v1"
>
```

`<CheckoutProvider>` builds the store once and, by default (`autoLoad`), calls
`GET /checkout/{slug}/runtime` on mount to load the catalog + form + steps. Then
your components read state through the hooks. **See `example-checkout.tsx` in this
folder for a complete, correct, restyle-me implementation.**

## The hooks (quick reference)

All from `@edgeos/checkout-react`. Each is a live subscription; components
re-render on relevant state changes.

| Hook | Gives you | Key members |
|---|---|---|
| `useCheckout()` | flow + submit | `runtime`, `currentStep`, `submitting`, `error`, `submit()`, `nextStep()`, `previousStep()`, `goToStep()` |
| `useCart()` | selection | `quantities`, `setQuantity(id, n)`, `selectProduct(id)`, `selectHousing`, `setInsurance`, … |
| `usePreview()` | **the price** | `status`, `preview` (full breakdown), `total`, `error` |
| `useBuyerForm()` | buyer + coupon | `values`, `setBuyer(patch)`, `coupon`, `applyCoupon(code)`, `clearCoupon()` |
| `useSteps()` | navigation only | `steps`, `currentStep`, `goToStep`, `nextStep`, `previousStep` |
| `useCheckoutState()` | the whole state object | (escape hatch) |

Full signatures and the underlying store actions: **`hooks-reference.md`**.

## Critical contract facts (read before writing UI)

These are the things that are non-obvious and **will bite you** if you guess. Full
detail in **`api-contract.md`**; the essentials:

1. **Money is always a decimal string** (`"498000.00"`), never a JS number.
   **Never `parseFloat` an authoritative amount** — render it verbatim (float drift
   corrupts totals). Format for display only if you keep the string authoritative.

2. **Price breakdown field names are tricky.** From `usePreview().preview`:
   - `total` — what the buyer is charged. Show this.
   - `discount_amount` — the amount **saved** by the coupon → this is your "You saved X".
   - `discountable_amount` — the discountable portion **AFTER** discount (net). **Not** a subtotal. Don't show it as "subtotal".
   - There is **no pre-discount subtotal field**, and you can't sum lines yourself (no parsing). Per-line `line_total` is gross (pre-discount).
   - Zero serializes as `"0.00"`, not `"0"` — compare with care (see api-contract.md).

3. **Buyer fields: the `custom_` prefix is mandatory.** Only `email`,
   `first_name`, `last_name` are stored raw. **Every other field** (phone, custom
   questions, dietary, etc.) must be stored in buyer state with a `custom_` prefix
   — e.g. `setBuyer({ custom_phone: "..." })`. The core strips the prefix into the
   API's `form_data`. **A non-prefixed field other than the three named ones is
   silently dropped and never reaches the backend.**

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
   `usePreview().status` goes `"loading"` then settles. `total` is `null` when the
   cart is empty. Gate your "Pay/Continue" button on `preview.total !== null`.

6. **Runtime load has no built-in error state.** `useCheckout().runtime === null`
   means "loading **or** failed" — the provider swallows the fetch error. If you
   need to distinguish (retry UI), **prefetch the runtime yourself** and pass it as
   `initialRuntime` with `autoLoad={false}`. Pattern in `example-checkout.tsx`.

## Client-side buyer validation (optional but recommended)

The core ships the exact same Zod validator the EdgeOS portal uses, so you can
validate before submit instead of round-tripping to a `422`:

```ts
import { buildFormZodSchema, validateBuyerValues } from "@edgeos/checkout-react"

const schema = buildFormZodSchema(runtime.form_schema)   // form_schema from runtime
const { valid, errors } = validateBuyerValues(schema, values) // errors: field → message
```

## Common mistakes

| Mistake | Fix |
|---|---|
| `parseFloat(preview.total)` for display math | Keep money as the string; never parse authoritative amounts |
| Showing `discountable_amount` as "subtotal" | It's post-discount net; use `discount_amount` for savings, `total` for the charge |
| Storing `phone` as `setBuyer({ phone })` | Custom fields need the prefix: `setBuyer({ custom_phone })` |
| Treating `submit()` as "order done" | It returns a `checkoutUrl` — you must redirect to it |
| Spinner forever because `runtime` is null | A failed `/runtime` looks identical to loading — prefetch + `initialRuntime` to detect errors |
| Setting `baseUrl` when you don't need to | Leave it unset — it defaults to prod. Only override for dev/staging/proxy |
| Overridden `baseUrl` includes the slug, or omits `/api/v1` | When you do override, it's the API root **with** `/api/v1`, **without** the slug |
| Changing `slug`/`key` props after mount | The store is built once; remount the provider (e.g. `key={slug}`) to switch popups |
| `403` on every call in production | Your origin isn't on the key's allowlist — ask the operator to add it |

## Reference files in this folder

- **`example-checkout.tsx`** — one complete, correct integration. Copy and restyle.
- **`api-contract.md`** — endpoints, every response field, money/status semantics, error codes.
- **`hooks-reference.md`** — every hook + store action, full signatures, gotchas.

## Scope note

This skill covers the common single-page ticket checkout (products + quantities +
buyer + coupon + pay). The SDK also supports housing (date ranges), an insurance
toggle, multi-step flows from `runtime.ticketing_steps`, cart persistence/restore,
and analytics adapters (Meta Pixel / GA). Those are in `hooks-reference.md` and
`api-contract.md` — reach for them when the popup uses those features.
