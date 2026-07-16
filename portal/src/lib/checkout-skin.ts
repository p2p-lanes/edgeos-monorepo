import type { PopupPublic } from "@/client"

/** Visual skins for the checkout. Generic axis, independent of the shell.
 *  `default` = platform theming only; `amanita` = the Amanita brand skin. */
export type CheckoutSkin = "default" | "amanita"

const SKINS: readonly CheckoutSkin[] = ["default", "amanita"]

/** Resolve the popup's checkout skin from theme_config. Unknown/absent → default. */
export function resolveCheckoutSkin(
  popup: PopupPublic | null | undefined,
): CheckoutSkin {
  const raw = popup?.theme_config?.checkout_skin
  return SKINS.includes(raw as CheckoutSkin) ? (raw as CheckoutSkin) : "default"
}
