# @edgeos/checkout-react

React adapter for the EdgeOS **headless checkout SDK**. A `<CheckoutProvider>`
plus hooks over [`@edgeos/checkout-core`](https://www.npmjs.com/package/@edgeos/checkout-core)
— you build your own UI, the SDK does the rest (catalog, cart, server-authoritative
pricing, buyer form, coupons, the SimpleFi payment redirect). It re-exports the
core, so this is the only package a React app needs.

## Install

```bash
npm install @edgeos/checkout-react
```

`react` / `react-dom` (18 or 19) are peer dependencies.

## What you need

Two values, from your EdgeOS backoffice (**Organization → Checkout SDK Keys**):

- a **publishable key** (`pk_live_…`)
- your **popup slug**

The API URL defaults to the EdgeOS production API; pass `baseUrl` only to point at
a non-prod backend.

## Quick start

```tsx
import { CheckoutProvider, useCheckout, useCart, usePreview } from "@edgeos/checkout-react"

function App() {
  return (
    <CheckoutProvider slug="my-popup" publishableKey="pk_live_…">
      <Checkout />
    </CheckoutProvider>
  )
}

function Checkout() {
  const { runtime, submit } = useCheckout()
  const { quantities, setQuantity } = useCart()
  const { total } = usePreview()          // server-authoritative, money as a string
  // …render runtime.products, steppers, total, buyer form, then:
  // const { checkoutUrl } = await submit(); window.location.assign(checkoutUrl)
}
```

## Build your checkout with Claude Code

This package ships a **Claude Code skill** at
`node_modules/@edgeos/checkout-react/skills/building-edgeos-checkout/`. Copy that
folder into your project's `.claude/skills/` (or ask your Claude Code to do it),
and it will scaffold a correct, restyle-me checkout on this SDK — it documents
every hook, the API contract, money/step/buyer-form rules, and includes a
complete example.

## License

MIT
