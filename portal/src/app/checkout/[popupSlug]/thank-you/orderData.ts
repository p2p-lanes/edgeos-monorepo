export type ThankYouOrderItem = {
  title: string
  qty: number
  price?: number
}

export type ThankYouOrder = {
  order_id?: string
  first_name?: string
  email_hash?: string
  items?: ThankYouOrderItem[]
  amount_total?: string | number
  currency?: string
  issued_at?: string
}

export type ThankYouTheme = {
  title?: string
  description?: string
  background?: {
    color?: string
    image_url?: string
  }
  text_color?: string
  accent_color?: string
  icon?: {
    show?: boolean
    color?: string
  }
  cta?: {
    show?: boolean
    label?: string
    url?: string
  }
  show_order_summary?: boolean
}

/**
 * Decode the base64url(JSON) order snapshot appended by the backend to the
 * thank-you URL. Returns null for a missing or malformed param — the data is
 * cosmetic, so a bad value just falls back to the generic confirmation.
 */
export function decodeOrderData(data: string | null): ThankYouOrder | null {
  if (!data) return null
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json)
    if (typeof parsed !== "object" || parsed === null) return null

    const order = parsed as Omit<ThankYouOrder, "items"> & {
      items?: Array<{
        title?: unknown
        qty?: unknown
        price?: unknown
        name?: unknown
        quantity?: unknown
      }>
    }
    const items = Array.isArray(order.items)
      ? order.items.flatMap((item) => {
          const title =
            typeof item.title === "string"
              ? item.title
              : typeof item.name === "string"
                ? item.name
                : null
          const qty =
            typeof item.qty === "number"
              ? item.qty
              : typeof item.quantity === "number"
                ? item.quantity
                : null
          if (title === null || qty === null) return []
          return [
            {
              title,
              qty,
              ...(typeof item.price === "number" ? { price: item.price } : {}),
            },
          ]
        })
      : undefined
    return { ...order, items }
  } catch {
    return null
  }
}

/** Replace {placeholder} tokens with order values; unknown tokens become "". */
export function interpolate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "")
}
