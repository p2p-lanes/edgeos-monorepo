import type { PopupPublic } from "@/client"

export function resolveCheckoutBackgroundUrl(
  popup: PopupPublic | null | undefined,
): string | null {
  return popup?.express_checkout_background || null
}

export function getBackgroundProps(popup: PopupPublic | null | undefined): {
  className: string
  style: React.CSSProperties | undefined
} {
  const imageUrl = resolveCheckoutBackgroundUrl(popup)

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
