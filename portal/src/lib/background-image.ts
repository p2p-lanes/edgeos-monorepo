import type { PopupPublic, TenantPublic } from "@/client"

/**
 * Resolves the background image URL using a fallback chain:
 * 1. popup.express_checkout_background
 * 2. popup.image_url
 * 3. tenant.image_url
 * 4. null (falls back to CSS gradient placeholder)
 */
export function resolveBackgroundImageUrl(
  popup: PopupPublic | null | undefined,
  tenant: TenantPublic | null | undefined,
): string | null {
  return (
    popup?.express_checkout_background ||
    popup?.image_url ||
    tenant?.image_url ||
    null
  )
}

/**
 * Returns inline style + className for a full-page background image
 * with the standard fallback chain: popup → tenant → gradient placeholder.
 */
export function getBackgroundProps(
  popup: PopupPublic | null | undefined,
  tenant: TenantPublic | null | undefined,
): {
  className: string
  style: React.CSSProperties | undefined
} {
  const imageUrl = resolveBackgroundImageUrl(popup, tenant)

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
    className: "bg-gradient-to-br from-neutral-100 to-neutral-300",
    style: undefined,
  }
}
