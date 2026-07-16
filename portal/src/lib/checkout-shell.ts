import type { PopupPublic } from "@/client"

/** Checkout navigation/layout shells. Generic — reusable across tenants.
 *  `scrolly` = the current continuous scroll-snap flow (default).
 *  `stepper` = one section at a time with a pills nav + fixed bottom bar. */
export type CheckoutShell = "scrolly" | "stepper"

const SHELLS: readonly CheckoutShell[] = ["scrolly", "stepper"]

/** Resolve which checkout shell a popup uses from its theme_config. Absent or
 *  unknown values fall back to "scrolly" so existing popups are unaffected. */
export function resolveCheckoutShell(
  popup: PopupPublic | null | undefined,
): CheckoutShell {
  const raw = (popup?.theme_config as { checkout_shell?: unknown } | null)
    ?.checkout_shell
  return SHELLS.includes(raw as CheckoutShell)
    ? (raw as CheckoutShell)
    : "scrolly"
}
