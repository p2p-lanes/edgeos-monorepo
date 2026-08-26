"use client"

/**
 * Moved to `@edgeos/shared-form-ui` so the backoffice icon picker offers the
 * exact components the checkout renders. Kept here as a re-export: the
 * existing `@/lib/checkoutStepIcons` imports in `ScrollySectionNav` and
 * `CartItemList` are unchanged.
 */
export type {
  CheckoutIconEntry,
  CheckoutIconGroup,
  LucideLikeIcon,
} from "@edgeos/shared-form-ui"
export {
  CHECKOUT_ICON_CATALOG,
  CHECKOUT_ICON_GROUPS,
  getRegistryIcon,
  resolveStepIcon,
} from "@edgeos/shared-form-ui"
