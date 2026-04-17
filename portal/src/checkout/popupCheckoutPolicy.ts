/**
 * Popup checkout policy — resolves how a popup's checkout UI should behave
 * based on its `sale_type` (application vs direct) and its future
 * `checkout_mode` (pass_system vs simple_quantity).
 *
 * Feature 1 scope: `sale_type` is the primary axis and drives the direct-sale
 * flow. `checkout_mode` is plumbed through here but always resolves to
 * "pass_system" because the backend has not yet introduced the field
 * (that lands in Feature 3). The policy shape is future-proof so consumers
 * can branch on `isPassSystem` / `isSimpleQuantity` today without a
 * follow-up refactor.
 */

export type CheckoutMode = "pass_system" | "simple_quantity"

export type PopupSaleType = "application" | "direct"

/**
 * Source shape used to derive the policy. Accepts the nullable fields that
 * the generated `PopupPublic` client type exposes (`sale_type` is optional,
 * `checkout_mode` doesn't exist yet but is declared here as a TODO/stub).
 */
export interface PopupCheckoutPolicySource {
  sale_type?: PopupSaleType | null
  // TODO(feat/checkout-mode): wire this once the backend adds the field
  // (Feature 3). Today the backend always implies "pass_system".
  checkout_mode?: CheckoutMode | null
}

export interface PopupCheckoutPolicy {
  saleType: PopupSaleType
  checkoutMode: CheckoutMode
  isPassSystem: boolean
  isSimpleQuantity: boolean
}

const DEFAULT_SALE_TYPE: PopupSaleType = "application"
const DEFAULT_CHECKOUT_MODE: CheckoutMode = "pass_system"

/**
 * Resolve the checkout policy for a popup. Safe to call with `null` or
 * `undefined` — returns the application / pass-system defaults, which match
 * the legacy behavior of the portal before `sale_type` was introduced.
 */
export function resolvePopupCheckoutPolicy(
  popup: PopupCheckoutPolicySource | null | undefined,
): PopupCheckoutPolicy {
  const saleType: PopupSaleType =
    popup?.sale_type === "direct" ? "direct" : DEFAULT_SALE_TYPE

  // Feature 1: backend does not yet expose `checkout_mode`, so we always
  // resolve to the default. When the field lands the resolver will honor it
  // automatically.
  const checkoutMode: CheckoutMode =
    popup?.checkout_mode === "simple_quantity"
      ? "simple_quantity"
      : DEFAULT_CHECKOUT_MODE

  return {
    saleType,
    checkoutMode,
    isPassSystem: checkoutMode === "pass_system",
    isSimpleQuantity: checkoutMode === "simple_quantity",
  }
}
