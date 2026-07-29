// @edgeos/checkout-core — framework-agnostic headless checkout engine.
// Public surface grows as modules land (see
// docs/superpowers/plans/2026-07-29-headless-checkout-sdk-CONTINUATION.md, Plan 2).

export {
  type CheckoutClient,
  type CheckoutClientOptions,
  createCheckoutClient,
} from "./client"
export * from "./selection"
export * from "./steps"
export { CheckoutApiError } from "./transport/errors"
export { createFetchTransport } from "./transport/fetchTransport"
export type {
  CheckoutClientConfig,
  HttpMethod,
  RequestOptions,
  Transport,
} from "./transport/types"
export type * from "./types/api"
export type { CheckoutStep } from "./types/checkout"
