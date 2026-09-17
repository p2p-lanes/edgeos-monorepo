// How a client boots the reference checkout on their own page. Wrap the app in
// <CheckoutProvider> with the popup slug + the tenant publishable key
// (pk_live_…, browser-safe) and the API base URL. The provider fetches the
// catalogue and the buyer form, and drives everything through the headless
// core. No sales flow is named: the SDK resolves the popup's primary one.
//
// This file is illustrative (not run by the test). In a real app this is your
// Vite/Next entry point.

import { CheckoutProvider } from "@edgeos/checkout-react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { CustomCheckout } from "./CustomCheckout"

const rootEl = document.getElementById("root")
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <CheckoutProvider
        slug="my-event"
        baseUrl="https://api.edgeos.example/api/v1"
        publishableKey="pk_live_replace_me"
      >
        <CustomCheckout />
      </CheckoutProvider>
    </StrictMode>,
  )
}
