// A tiny fan-out bus: register adapters, emit normalized events. Adapter errors
// are swallowed so a broken analytics vendor never breaks checkout.

import type {
  AnalyticsAdapter,
  AnalyticsLine,
  AnalyticsPopup,
  AnalyticsProduct,
  CheckoutAnalyticsEvent,
} from "./events"

export interface AnalyticsBus {
  /** Register an adapter; returns an unsubscribe. */
  use(adapter: AnalyticsAdapter): () => void
  /** Fan an event out to every adapter (errors isolated per adapter). */
  emit(event: CheckoutAnalyticsEvent): void
  viewContent(popup: AnalyticsPopup, products: AnalyticsProduct[]): void
  addToCart(
    popup: AnalyticsPopup,
    product: AnalyticsProduct,
    quantity: number,
  ): void
  initiateCheckout(popup: AnalyticsPopup, products: AnalyticsProduct[]): void
  purchase(args: {
    paymentId: string
    popup: AnalyticsPopup
    amount: number | string
    currency: string
    products: AnalyticsLine[]
  }): void
}

export function createAnalyticsBus(
  initial: AnalyticsAdapter[] = [],
): AnalyticsBus {
  const adapters = new Set<AnalyticsAdapter>(initial)

  function emit(event: CheckoutAnalyticsEvent) {
    for (const adapter of adapters) {
      try {
        adapter.track(event)
      } catch {
        // Isolate a misbehaving adapter — checkout must not break on tracking.
      }
    }
  }

  return {
    use(adapter) {
      adapters.add(adapter)
      return () => adapters.delete(adapter)
    },
    emit,
    viewContent(popup, products) {
      emit({ type: "view_content", popup, products })
    },
    addToCart(popup, product, quantity) {
      emit({ type: "add_to_cart", popup, product, quantity })
    },
    initiateCheckout(popup, products) {
      emit({ type: "initiate_checkout", popup, products })
    },
    purchase(args) {
      emit({ type: "purchase", ...args })
    },
  }
}
