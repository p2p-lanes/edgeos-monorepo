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

// Treat any .mp4 (case-insensitive, query-strings ignored) as a video.
// Other extensions are assumed to be images — same as before this field
// accepted video.
function isVideoUrl(url: string): boolean {
  const pathname = url.split("?")[0].split("#")[0].toLowerCase()
  return pathname.endsWith(".mp4")
}

export type CheckoutBackground =
  | { type: "none"; className: string }
  | { type: "image"; className: string; style: React.CSSProperties }
  | { type: "video"; className: string; url: string }

export function getCheckoutBackground(
  popup: PopupPublic | null | undefined,
  context: CheckoutBackgroundContext,
): CheckoutBackground {
  const url = resolveCheckoutBackgroundUrl(popup, context)

  if (!url) {
    return { type: "none", className: "bg-background" }
  }

  if (isVideoUrl(url)) {
    return { type: "video", className: "", url }
  }

  return {
    type: "image",
    className: "",
    style: {
      backgroundImage: `url(${url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "fixed",
    },
  }
}

// Back-compat wrapper. Returns the spread-onto-main shape image consumers
// have always used. Video URLs now collapse to the empty/no-bg case so
// callers that haven't migrated to <CheckoutBackgroundLayer> don't break.
export function getBackgroundProps(
  popup: PopupPublic | null | undefined,
  context: CheckoutBackgroundContext,
): {
  className: string
  style: React.CSSProperties | undefined
} {
  const bg = getCheckoutBackground(popup, context)
  if (bg.type === "image") return { className: bg.className, style: bg.style }
  return { className: bg.className || "bg-background", style: undefined }
}
