// How a client boots the reference checkout on their own page. Wrap the app in
// <CheckoutProvider> with the popup slug + the per-popup publishable key
// (pk_live_…, browser-safe) and the API base URL. The provider fetches the
// runtime and drives everything through the headless core.
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
