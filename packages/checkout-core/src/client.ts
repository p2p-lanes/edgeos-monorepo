import { createFetchTransport } from "./transport/fetchTransport"
import type { CheckoutClientConfig, Transport } from "./transport/types"
import type {
  CheckoutPreviewRequest,
  CheckoutPreviewResponse,
  CheckoutRuntimeResponse,
  CouponValidatePublicResponse,
  OpenCartPublic,
  OpenCartUpsert,
  OpenTicketingPurchaseCreate,
  OpenTicketingPurchaseResponse,
} from "./types/api"

/**
 * Typed wrappers over the anonymous EdgeOS checkout endpoints. Each method is a
 * thin call over the injected {@link Transport} — no orchestration, no caching.
 * Higher layers (pricing driver, store) compose these.
 */
export interface CheckoutClient {
  /** GET /checkout/{slug}/runtime — popup, products, buyer form, steps. */
  getRuntime(): Promise<CheckoutRuntimeResponse>
  /** POST /checkout/{slug}/preview — authoritative price breakdown. */
  preview(body: CheckoutPreviewRequest): Promise<CheckoutPreviewResponse>
  /** POST /coupons/validate-public — validate a code against this popup. */
  validateCoupon(code: string): Promise<CouponValidatePublicResponse>
  /** POST /checkout/{slug}/purchase — create the payment, get the pay URL. */
  purchase(
    body: OpenTicketingPurchaseCreate,
  ): Promise<OpenTicketingPurchaseResponse>
  /** PUT /checkout/{slug}/cart — persist the anonymous cart by email. */
  upsertCart(body: OpenCartUpsert): Promise<OpenCartPublic>
  /** GET /checkout/{slug}/cart?cid&sig — restore a cart from a signed link. */
  restoreCart(cid: string, sig: string): Promise<OpenCartPublic>
}

/** Slug the client targets, plus (optionally) how to build the default transport. */
export type CheckoutClientOptions =
  | { slug: string; baseUrl?: string; publishableKey?: string; fetch?: typeof fetch }
  | CheckoutClientConfig

/**
 * Build a {@link CheckoutClient} for one popup slug.
 *
 * Pass a `transport` to inject the HTTP boundary (tests, SSR, custom auth). When
 * omitted, a default fetch transport is built from `config` — which then must
 * include `baseUrl`.
 */
export function createCheckoutClient(
  config: CheckoutClientOptions,
  transport?: Transport,
): CheckoutClient {
  const t = transport ?? buildDefaultTransport(config)
  const slug = encodeURIComponent(config.slug)
  const base = `/checkout/${slug}`

  return {
    getRuntime() {
      return t.request<CheckoutRuntimeResponse>("GET", `${base}/runtime`)
    },
    preview(body) {
      return t.request<CheckoutPreviewResponse>("POST", `${base}/preview`, body)
    },
    validateCoupon(code) {
      return t.request<CouponValidatePublicResponse>(
        "POST",
        "/coupons/validate-public",
        { popup_slug: config.slug, code },
      )
    },
    purchase(body) {
      return t.request<OpenTicketingPurchaseResponse>(
        "POST",
        `${base}/purchase`,
        body,
      )
    },
    upsertCart(body) {
      return t.request<OpenCartPublic>("PUT", `${base}/cart`, body)
    },
    restoreCart(cid, sig) {
      const query = `cid=${encodeURIComponent(cid)}&sig=${encodeURIComponent(sig)}`
      return t.request<OpenCartPublic>("GET", `${base}/cart?${query}`)
    },
  }
}

function buildDefaultTransport(config: CheckoutClientOptions): Transport {
  const baseUrl = "baseUrl" in config ? config.baseUrl : undefined
  if (!baseUrl) {
    throw new Error(
      "createCheckoutClient: config.baseUrl is required when no transport is provided.",
    )
  }
  return createFetchTransport({
    baseUrl,
    slug: config.slug,
    publishableKey: config.publishableKey,
    fetch: config.fetch,
  })
}
