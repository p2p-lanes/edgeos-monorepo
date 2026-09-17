# @edgeos/checkout-core

Framework-agnostic **headless checkout engine** for EdgeOS. All the checkout
logic (catalogue, cart, server-authoritative pricing, buyer-form validation,
coupons, payment handoff, analytics) with **zero UI and zero framework**. Bring
your own components, and your own screens: the SDK has no opinion about how
many steps your checkout has or when the buyer moves between them.

Using React? Install [`@edgeos/checkout-react`](https://www.npmjs.com/package/@edgeos/checkout-react)
instead — it re-exports everything here plus a provider and hooks.

## Install

```bash
npm install @edgeos/checkout-core
```

## What you need

Two values, from your EdgeOS backoffice (**Organization → Checkout SDK Keys**):

- a **publishable key** (`pk_live_…`, browser-safe, origin-allowlisted)
- your **popup slug**

The key is required: it is what tells EdgeOS the request is yours rather than
the EdgeOS portal's, which is why your checkout is served the popup's whole
catalogue. The API URL defaults to the EdgeOS production API; override
`baseUrl` only for a non-prod environment.

## Quick start

```ts
import { createCheckoutClient, createCheckoutStore } from "@edgeos/checkout-core"

const client = createCheckoutClient({
  slug: "my-popup",
  publishableKey: "pk_live_…",
})
const store = createCheckoutStore({ client })

store.subscribe((state) => {
  // re-render your UI from state.products / state.selection / state.pricing …
})
await store.load()                  // fetch the catalogue + the buyer form
store.setQuantity(productId, 2)     // triggers a debounced authoritative /preview
const result = await store.submit() // → { checkoutUrl } to redirect the buyer
```

## Key facts

- **Money is always a decimal string** (`"498000.00"`) — never `parseFloat` an authoritative amount.
- **The server computes prices.** You never do checkout math; read `state.pricing.preview`.
- `submit()` returns a `checkoutUrl` (SimpleFi hosted page). You redirect there; it does not "complete" the order.
- **Your checkout owns its screens and its gating.** EdgeOS ticketing steps are not surfaced here, and who may buy is your call.
- **Every ticket names a buyer.** `submit()` fills that in for you; a checkout that buys tickets for other people calls the client directly with its own `recipients`.

The public surface (client, store, selection, order, pricing, cart, form,
analytics, and all types) is exported from the package root.

## Build your checkout with Claude Code

This package ships a **Claude Code skill** at
`node_modules/@edgeos/checkout-core/skills/building-edgeos-checkout/`. Copy that
folder into your project's `.claude/skills/` (or ask your Claude Code to do it),
and it will scaffold a correct, restyle-me checkout on this SDK. It documents the
full API contract, the framework-agnostic store, money and buyer-form rules, and
ships two complete examples — one **vanilla/no-framework** (`example-vanilla.ts`)
and one **React** (`example-checkout.tsx`). React users get this same skill
transitively (the React package depends on this one).

## License

MIT
