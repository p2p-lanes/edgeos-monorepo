import type { CheckoutStore } from "@edgeos/checkout-core"
import { createContext, useContext } from "react"

/** Holds the framework-agnostic store instance for the subtree. */
export const CheckoutStoreContext = createContext<CheckoutStore | null>(null)

/** Access the raw store. Throws if used outside a <CheckoutProvider>. */
export function useCheckoutStore(): CheckoutStore {
  const store = useContext(CheckoutStoreContext)
  if (!store) {
    throw new Error("useCheckoutStore must be used within a <CheckoutProvider>")
  }
  return store
}
