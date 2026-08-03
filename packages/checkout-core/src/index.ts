// @edgeos/checkout-core — framework-agnostic headless checkout engine.
//
// Public surface (Plan 2 complete). The React adapter (@edgeos/checkout-react,
// Plan 3) and any custom checkout UI consume ONLY what is exported here:
//   - createCheckoutStore   — the orchestration brain (subscribe/getState/actions)
//   - createCheckoutClient / createFetchTransport — the API boundary
//   - selection / steps / order / pricing / cart / form — pure building blocks
//   - analytics bus + Meta Pixel / GA adapters
//   - all public types (API contract, form schema, checkout step)
// Zero React imports live in this package.

export {
  type CheckoutClient,
  type CheckoutClientOptions,
  createCheckoutClient,
} from "./client"
export * from "./analytics"
export * from "./cart"
export * from "./form"
export * from "./order"
export * from "./pricing"
export * from "./selection"
export * from "./steps"
export * from "./store"
export { CheckoutApiError } from "./transport/errors"
export { createFetchTransport, DEFAULT_BASE_URL } from "./transport/fetchTransport"
export type {
  CheckoutClientConfig,
  HttpMethod,
  RequestOptions,
  Transport,
} from "./transport/types"
export type * from "./types/api"
export type { CheckoutStep } from "./types/checkout"
export type {
  ApplicationFormSchema,
  FormFieldSchema,
  FormFieldType,
  MultiSelectDetailedConfig,
} from "./types/form"
