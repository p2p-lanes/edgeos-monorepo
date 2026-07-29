// Google Analytics (gtag) adapter. Ports the payloads from portal
// `lib/google-analytics.ts`. `gtag` is injectable; defaults to `window.gtag`.

import type {
  AnalyticsAdapter,
  AnalyticsPopup,
  AnalyticsProduct,
  CheckoutAnalyticsEvent,
} from "./events"

type Gtag = (...args: unknown[]) => void

export interface GaAdapterOptions {
  /** Defaults to `window.gtag` resolved at call time. */
  gtag?: Gtag
}

function popupParams(popup: AnalyticsPopup) {
  return { popup_id: popup.id, popup_slug: popup.slug, popup_name: popup.name }
}

function productItems(products: AnalyticsProduct[]) {
  return products
    .filter((p) => p.is_active !== false)
    .map((p) => ({
      item_id: p.id,
      item_name: p.name,
      quantity: 1,
      price: Number(p.price),
    }))
}

export function createGaAdapter(options: GaAdapterOptions = {}): AnalyticsAdapter {
  function resolveGtag(): Gtag | null {
    if (options.gtag) return options.gtag
    if (typeof window === "undefined") return null
    const gtag = (window as Window & { gtag?: Gtag }).gtag
    return typeof gtag === "function" ? gtag : null
  }

  function track(eventName: string, params: Record<string, unknown>) {
    const gtag = resolveGtag()
    if (!gtag) return
    gtag("event", eventName, params)
  }

  return {
    track(event: CheckoutAnalyticsEvent) {
      switch (event.type) {
        case "view_content": {
          const items = productItems(event.products)
          track("view_item", {
            ...popupParams(event.popup),
            currency: event.popup.currency,
            value: items.reduce((t, i) => t + i.price, 0),
            items,
          })
          break
        }
        case "add_to_cart": {
          if (event.quantity <= 0) return
          const unitPrice = Number(event.product.price)
          track("add_to_cart", {
            ...popupParams(event.popup),
            currency: event.product.currency ?? event.popup.currency,
            value: unitPrice * event.quantity,
            items: [
              {
                item_id: event.product.id,
                item_name: event.product.name,
                item_category: event.product.category,
                quantity: event.quantity,
                price: unitPrice,
              },
            ],
          })
          break
        }
        case "initiate_checkout": {
          const items = productItems(event.products)
          track("begin_checkout", {
            ...popupParams(event.popup),
            currency: event.popup.currency,
            value: items.reduce((t, i) => t + i.price, 0),
            items,
          })
          break
        }
        case "purchase": {
          track("purchase", {
            ...popupParams(event.popup),
            transaction_id: event.paymentId,
            currency: event.currency,
            value: Number(event.amount),
            items: event.products.map((p) => ({
              item_id: p.product_id,
              quantity: p.quantity ?? 1,
              price: 0,
            })),
          })
          break
        }
      }
    },
  }
}
