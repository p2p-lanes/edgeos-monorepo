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

export const TICKET_CATEGORY = "ticket"

export function getEffectiveCheckoutMode(
  category: string | undefined | null,
  popupMode: CheckoutMode,
): CheckoutMode {
  return category === TICKET_CATEGORY
    ? popupMode
    : CHECKOUT_MODE.SIMPLE_QUANTITY
}

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
 * How a way in sells.
 *
 * A door of type `direct` or `upsale` sells to whoever arrives, one quantity
 * at a time; an `application` door sells passes to people who were accepted,
 * one per attendee. That used to be asked of the popup, which cannot answer
 * for a gathering whose doors differ — and one that takes applications may
 * still have a partner's door that sells directly
 * (sdd/sales-flows-rediseno slice 6).
 *
 * `null` means no door is in scope yet, and the answer is the same default
 * the portal has always started from.
 */
export function resolveFlowCheckoutPolicy(
  flowType: string | null | undefined,
): PopupCheckoutPolicy {
  const sellsDirectly = flowType === "direct" || flowType === "upsale"
  const checkoutMode = sellsDirectly
    ? CHECKOUT_MODE.SIMPLE_QUANTITY
    : CHECKOUT_MODE.PASS_SYSTEM

  return {
    saleType: sellsDirectly ? SALE_TYPE.DIRECT : SALE_TYPE.APPLICATION,
    checkoutMode,
    isPassSystem: checkoutMode === CHECKOUT_MODE.PASS_SYSTEM,
    isSimpleQuantity: checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY,
  }
}

/**
 * Resolve the checkout policy for a popup. Safe to call with `null` or
 * `undefined` — returns the application / pass-system defaults, which match
 * the legacy behavior of the portal before `sale_type` was introduced.
 *
 * @deprecated Ask the door instead — `resolveFlowCheckoutPolicy`. A popup's
 * `sale_type` cannot describe a gathering that both takes applications and
 * sells directly, which is the whole point of having flows. Kept while the
 * last call sites move over.
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
