import type { PopupPublic } from "@/client"

/**
 * Popup checkout policy — resolves how a popup's checkout UI should behave
 * from the backend popup contract. `checkout_mode` is authoritative when the
 * API provides it; deriving from `sale_type` remains only as a stale-client
 * fallback.
 */

export const CHECKOUT_MODE = {
  PASS_SYSTEM: "pass_system",
  SIMPLE_QUANTITY: "simple_quantity",
} as const

export type CheckoutMode = (typeof CHECKOUT_MODE)[keyof typeof CHECKOUT_MODE]

export const SALE_TYPE = {
  APPLICATION: "application",
  DIRECT: "direct",
} as const

export type PopupSaleType = (typeof SALE_TYPE)[keyof typeof SALE_TYPE]

export type PopupCheckoutPolicySource = Pick<
  PopupPublic,
  "sale_type" | "checkout_mode"
>

export interface PopupCheckoutPolicy {
  saleType: PopupSaleType
  checkoutMode: CheckoutMode
  isPassSystem: boolean
  isSimpleQuantity: boolean
}

const DEFAULT_SALE_TYPE: PopupSaleType = SALE_TYPE.APPLICATION
const DEFAULT_CHECKOUT_MODE: CheckoutMode = CHECKOUT_MODE.PASS_SYSTEM

function deriveCheckoutModeFromSaleType(saleType: PopupSaleType): CheckoutMode {
  return saleType === SALE_TYPE.DIRECT
    ? CHECKOUT_MODE.SIMPLE_QUANTITY
    : CHECKOUT_MODE.PASS_SYSTEM
}

/**
 * Resolve the checkout policy for a popup. Safe to call with `null` or
 * `undefined` — returns the application / pass-system defaults, which match
 * the legacy behavior of the portal before `sale_type` was introduced.
 */
export function resolvePopupCheckoutPolicy(
  popup: PopupCheckoutPolicySource | null | undefined,
): PopupCheckoutPolicy {
  const saleType: PopupSaleType =
    popup?.sale_type === SALE_TYPE.DIRECT ? SALE_TYPE.DIRECT : DEFAULT_SALE_TYPE

  const checkoutMode: CheckoutMode =
    popup?.checkout_mode === CHECKOUT_MODE.PASS_SYSTEM ||
    popup?.checkout_mode === CHECKOUT_MODE.SIMPLE_QUANTITY
      ? popup.checkout_mode
      : (deriveCheckoutModeFromSaleType(saleType) ?? DEFAULT_CHECKOUT_MODE)

  return {
    saleType,
    checkoutMode,
    isPassSystem: checkoutMode === CHECKOUT_MODE.PASS_SYSTEM,
    isSimpleQuantity: checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY,
  }
}
