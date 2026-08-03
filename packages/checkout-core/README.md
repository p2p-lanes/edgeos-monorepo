# @edgeos/checkout-core

Framework-agnostic **headless checkout engine** for EdgeOS. All the checkout
logic — catalog, cart, server-authoritative pricing, step flow, buyer-form
validation, coupons, payment handoff, analytics — with **zero UI and zero
framework**. Bring your own components.

Using React? Install [`@edgeos/checkout-react`](https://www.npmjs.com/package/@edgeos/checkout-react)
instead — it re-exports everything here plus a provider and hooks, and ships a
Claude Code skill that scaffolds a full checkout.

## Install

```bash
npm install @edgeos/checkout-core
```

## What you need

Two values, from your EdgeOS backoffice (**Organization → Checkout SDK Keys**):

- a **publishable key** (`pk_live_…`, browser-safe, origin-allowlisted)
- your **popup slug**

The API URL defaults to the EdgeOS production API; override `baseUrl` only for a
non-prod environment.

## Quick start

```ts
import { createCheckoutClient, createCheckoutStore } from "@edgeos/checkout-core"

const client = createCheckoutClient({ slug: "my-popup", publishableKey: "pk_live_…" })
const store = createCheckoutStore({ client })

store.subscribe((state) => {
  // re-render your UI from state.runtime / state.selection / state.pricing …
})
await store.load()                 // fetch runtime, derive steps
store.setQuantity(productId, 2)     // triggers a debounced authoritative /preview
const result = await store.submit() // → { checkoutUrl } to redirect the buyer
```

## Key facts

- **Money is always a decimal string** (`"498000.00"`) — never `parseFloat` an authoritative amount.
- **The server computes prices.** You never do checkout math; read `state.pricing.preview`.
- `submit()` returns a `checkoutUrl` (SimpleFi hosted page) — you redirect there; it does not "complete" the order.

The public surface (client, store, selection, steps, order, pricing, cart, form,
analytics, and all types) is exported from the package root. The React adapter
documents the full contract in its bundled skill.

## License

MIT
