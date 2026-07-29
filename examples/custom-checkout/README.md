# Reference custom checkout

A minimal, fully client-hosted checkout built on the EdgeOS headless SDK. Copy
it as a starting point for a custom checkout UI: it imports **only**
`@edgeos/checkout-react` — no EdgeOS theme, no portal code — and lets the
headless core (`@edgeos/checkout-core`) own all the business logic.

## What it shows

| File | Purpose |
|------|---------|
| `src/main.tsx` | How to boot: wrap your UI in `<CheckoutProvider slug baseUrl publishableKey>` |
| `src/CustomCheckout.tsx` | The UI: products → totals → buyer → pay, using the SDK hooks |
| `src/CustomCheckout.test.tsx` | End-to-end smoke against a fake transport |

## The flow (and which hook owns each part)

1. **Products** come from the fetched runtime — `useCheckout().runtime.products`.
2. **Selection** — `useCart().setQuantity` / `selectProduct`.
3. **Total** is server-authoritative (the core debounces `POST /preview`) —
   `usePreview().total`. Never compute the payable total yourself.
4. **Buyer + coupon** — `useBuyerForm()` (`setBuyer`, `applyCoupon`).
5. **Pay** — `useCheckout().submit()` returns `{ checkoutUrl }`; redirect the
   buyer there (SimpleFi-hosted page). The server re-validates and charges.

## Auth: the publishable key

An external origin authenticates with a per-popup **publishable key**
(`pk_live_…`) — browser-safe, non-secret, scoped by an origin allowlist. Pass it
to `<CheckoutProvider publishableKey>`; the SDK sends it as the
`X-EdgeOS-Publishable-Key` header so the API resolves your popup + tenant.

## Run the smoke test

```bash
pnpm --filter @edgeos/example-custom-checkout test
pnpm --filter @edgeos/example-custom-checkout typecheck
```

The test drives the whole flow against a fake transport, so it needs no backend.
To run against a real backend, drop the `transport`/`initialRuntime` props in
`main.tsx` and set a real `baseUrl` + `publishableKey`.
