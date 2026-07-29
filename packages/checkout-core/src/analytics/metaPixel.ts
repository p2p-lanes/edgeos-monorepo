// Meta Pixel adapter. Ports the exact fbq payloads + dedup event IDs from portal
// `lib/meta-pixel.ts`. `fbq`, the session id and the clock are injectable so the
// adapter is testable and SSR-safe; defaults read the browser at call time.

import type {
  AnalyticsAdapter,
  AnalyticsPopup,
  AnalyticsProduct,
  CheckoutAnalyticsEvent,
} from "./events"

type Fbq = (...args: unknown[]) => void

export interface MetaPixelAdapterOptions {
  /** Defaults to `window.fbq` resolved at call time. */
  fbq?: Fbq
  /** Stable per-session id for ViewContent/AddToCart dedup. */
  sessionId?: () => string
  /** Clock for AddToCart event-id uniqueness (defaults to Date.now). */
  now?: () => number
}

const META_SESSION_ID_KEY = "edgeos_meta_session_id"
let memorySessionId: string | null = null

function genId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID()
    }
  } catch {
    // fall through
  }
  return `s-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

function defaultSessionId(): string {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const existing = window.sessionStorage.getItem(META_SESSION_ID_KEY)
      if (existing) return existing
      const next = genId()
      window.sessionStorage.setItem(META_SESSION_ID_KEY, next)
      return next
    }
  } catch {
    // sessionStorage blocked (private mode) — fall back to memory
  }
  if (!memorySessionId) memorySessionId = genId()
  return memorySessionId
}

function popupParams(popup: AnalyticsPopup) {
  return { popup_id: popup.id, popup_slug: popup.slug, popup_name: popup.name }
}

function productParams(products: AnalyticsProduct[]) {
  const visible = products.filter((p) => p.is_active !== false)
  const first = visible[0]
  return {
    content_ids: visible.map((p) => p.id),
    content_name: first?.name,
    content_type: "product",
    contents: visible.map((p) => ({
      id: p.id,
      item_price: Number(p.price),
      quantity: 1,
    })),
    currency: first?.currency,
    value: first ? Number(first.price) : 0,
  }
}

export function createMetaPixelAdapter(
  options: MetaPixelAdapterOptions = {},
): AnalyticsAdapter {
  const sessionId = options.sessionId ?? defaultSessionId
  const now = options.now ?? (() => Date.now())

  function resolveFbq(): Fbq | null {
    if (options.fbq) return options.fbq
    if (typeof window === "undefined") return null
    const fbq = (window as Window & { fbq?: Fbq }).fbq
    return typeof fbq === "function" ? fbq : null
  }

  function track(
    eventName: string,
    params: Record<string, unknown>,
    eventID: string,
  ) {
    const fbq = resolveFbq()
    if (!fbq) return
    fbq("track", eventName, params, { eventID })
  }

  return {
    track(event: CheckoutAnalyticsEvent) {
      switch (event.type) {
        case "view_content": {
          track(
            "ViewContent",
            { ...popupParams(event.popup), ...productParams(event.products) },
            `EVT_VIEW_${event.popup.id}_${sessionId()}`,
          )
          break
        }
        case "add_to_cart": {
          if (event.quantity <= 0) return
          const unitPrice = Number(event.product.price)
          track(
            "AddToCart",
            {
              ...popupParams(event.popup),
              content_ids: [event.product.id],
              content_name: event.product.name,
              content_type: "product",
              content_category: event.product.category,
              contents: [
                {
                  id: event.product.id,
                  item_price: unitPrice,
                  quantity: event.quantity,
                },
              ],
              currency: event.product.currency ?? event.popup.currency,
              num_items: event.quantity,
              value: unitPrice * event.quantity,
            },
            `EVT_CART_${event.popup.id}_${event.product.id}_${sessionId()}_${now()}`,
          )
          break
        }
        case "initiate_checkout": {
          track(
            "InitiateCheckout",
            { ...popupParams(event.popup), ...productParams(event.products) },
            `EVT_INIT_${event.popup.id}_${sessionId()}`,
          )
          break
        }
        case "purchase": {
          const contents = event.products.map((p) => ({
            id: p.product_id,
            quantity: p.quantity ?? 1,
          }))
          track(
            "Purchase",
            {
              ...popupParams(event.popup),
              content_ids: event.products.map((p) => p.product_id),
              content_type: "product",
              contents,
              currency: event.currency,
              num_items: contents.reduce((t, i) => t + i.quantity, 0),
              order_id: event.paymentId,
              value: Number(event.amount),
            },
            // Raw payment id so a partner firing Purchase with event_id=order_id
            // to the same pixel deduplicates against ours in Meta.
            String(event.paymentId),
          )
          break
        }
      }
    },
  }
}
