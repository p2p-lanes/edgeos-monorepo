// @edgeos/checkout-react — thin React adapter over @edgeos/checkout-core.
// A <CheckoutProvider> instantiates the core store; the hooks are selectors
// over it via useSyncExternalStore. All business logic lives in the core.

export {
  CheckoutProvider,
  type CheckoutProviderProps,
} from "./CheckoutProvider"
export { CheckoutStoreContext, useCheckoutStore } from "./context"
export {
  useBuyerForm,
  useCart,
  useCheckout,
  useCheckoutState,
  usePreview,
  useSteps,
} from "./hooks"

// Re-export the core so consumers get types + factories from one entry point.
export * from "@edgeos/checkout-core"
