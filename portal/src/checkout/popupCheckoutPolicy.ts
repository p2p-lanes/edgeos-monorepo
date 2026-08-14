/**
 * How a way into a gathering sells.
 *
 * This used to resolve from the popup's `sale_type` / `checkout_mode`, which
 * cannot answer for a gathering whose doors differ — one that takes
 * applications may still have a partner's door that sells directly. The
 * question belongs to the door (sdd/sales-flows-rediseno slice 6).
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

export interface PopupCheckoutPolicy {
  saleType: PopupSaleType
  checkoutMode: CheckoutMode
  isPassSystem: boolean
  isSimpleQuantity: boolean
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
