import {
  CHECKOUT_MODE,
  type CheckoutMode,
} from "@/checkout/popupCheckoutPolicy"
import type { AttendeeCategory } from "@/types/Attendee"

export function getPassSelectionLayout(
  checkoutMode: CheckoutMode,
): "grouped" | "flat" {
  return checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY ? "flat" : "grouped"
}

export function shouldDisableForPrimaryRestriction({
  checkoutMode,
  attendeeCategory,
  primaryHasPass,
}: {
  checkoutMode: CheckoutMode
  attendeeCategory: AttendeeCategory
  primaryHasPass: boolean
}): boolean {
  if (checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY) {
    return false
  }

  return attendeeCategory === "spouse" && !primaryHasPass
}
