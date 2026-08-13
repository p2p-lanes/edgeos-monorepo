/**
 * Internal checkout step identifiers used by the flow. Note "tickets" (the API
 * `step_type`) maps to "passes" here — kept for parity with the portal's step
 * model. "success" is a terminal UI state, not a configurable step.
 */
export type CheckoutStep =
  | "passes"
  | "tickets"
  | "buyer"
  | "housing"
  | "merch"
  | "patron"
  | "confirm"
  | "success"
