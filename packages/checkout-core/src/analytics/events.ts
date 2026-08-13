// Normalized, adapter-agnostic checkout analytics events. The core emits these;
// adapters (Meta Pixel, GA) translate them into vendor calls. Payload/timing
// semantics are ported from portal `lib/meta-pixel.ts` + `lib/google-analytics.ts`
// so a custom checkout keeps tracking parity with the portal.

export interface AnalyticsPopup {
  id: string
  slug: string
  name?: string | null
  currency?: string | null
}

export interface AnalyticsProduct {
  id: string
  name?: string | null
  price: number | string
  currency?: string | null
  category?: string | null
  /** When explicitly false the product is excluded (matches the portal). */
  is_active?: boolean
}

/** A purchased line (post-checkout) — carries no price, mirroring the portal. */
export interface AnalyticsLine {
  product_id: string
  quantity?: number
}

export type CheckoutAnalyticsEvent =
  | { type: "view_content"; popup: AnalyticsPopup; products: AnalyticsProduct[] }
  | {
      type: "add_to_cart"
      popup: AnalyticsPopup
      product: AnalyticsProduct
      quantity: number
    }
  | {
      type: "initiate_checkout"
      popup: AnalyticsPopup
      products: AnalyticsProduct[]
    }
  | {
      type: "purchase"
      paymentId: string
      popup: AnalyticsPopup
      amount: number | string
      currency: string
      products: AnalyticsLine[]
    }

/** A tracking sink. Implementations must never throw — the bus guards anyway. */
export interface AnalyticsAdapter {
  track(event: CheckoutAnalyticsEvent): void
}
