import type { PopupPublic } from "@/client"

export type CheckoutBackgroundContext = "checkout" | "groups" | "passes"

function getEnabledContexts(
  popup: PopupPublic | null | undefined,
): CheckoutBackgroundContext[] {
  const raw = popup?.theme_config?.checkout_background_contexts
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (value): value is CheckoutBackgroundContext =>
      value === "checkout" || value === "groups" || value === "passes",
  )
}

export function resolveCheckoutBackgroundUrl(
  popup: PopupPublic | null | undefined,
  context: CheckoutBackgroundContext,
): string | null {
  if (!getEnabledContexts(popup).includes(context)) return null
  return popup?.express_checkout_background || null
}

export function getBackgroundProps(
  popup: PopupPublic | null | undefined,
  context: CheckoutBackgroundContext,
): {
  className: string
  style: React.CSSProperties | undefined
} {
  const imageUrl = resolveCheckoutBackgroundUrl(popup, context)

  if (imageUrl) {
    return {
      className: "",
      style: {
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
      },
    }
  }

  return {
    className: "bg-background",
    style: undefined,
  }
}
