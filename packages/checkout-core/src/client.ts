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
  /** GET /checkout/{slug}/{flowSlug}/runtime — popup, products, buyer form, steps. */
  getRuntime(): Promise<CheckoutRuntimeResponse>
  /** POST /checkout/{slug}/{flowSlug}/preview — authoritative price breakdown. */
  preview(body: CheckoutPreviewRequest): Promise<CheckoutPreviewResponse>
  /** POST /coupons/validate-public — validate a code against this popup. */
  validateCoupon(code: string): Promise<CouponValidatePublicResponse>
  /** POST /checkout/{slug}/{flowSlug}/purchase — create the payment, get the pay URL. */
  purchase(
    body: OpenTicketingPurchaseCreate,
  ): Promise<OpenTicketingPurchaseResponse>
  /** PUT /checkout/{slug}/{flowSlug}/cart — persist the anonymous cart by email. */
  upsertCart(body: OpenCartUpsert): Promise<OpenCartPublic>
  /** GET /checkout/{slug}/{flowSlug}/cart?cid&sig — restore a cart from a signed link. */
  restoreCart(cid: string, sig: string): Promise<OpenCartPublic>
}

/** Canonical popup and sales-flow slugs plus transport configuration. */
export type CheckoutClientOptions = CheckoutClientConfig

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
  const flowSlug = encodeURIComponent(config.flowSlug)
  const base = `/checkout/${slug}/${flowSlug}`

  return {
    getRuntime() {
      return t.request<CheckoutRuntimeResponse>("GET", `${base}/runtime`)
    },
    preview(body) {
      return t.request<CheckoutPreviewResponse>(
        "POST",
        `${base}/preview`,
        body,
      )
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
  // baseUrl is optional — createFetchTransport falls back to the EdgeOS
  // production API (DEFAULT_BASE_URL) when it isn't provided.
  return createFetchTransport({
    baseUrl: config.baseUrl,
    slug: config.slug,
    flowSlug: config.flowSlug,
    publishableKey: config.publishableKey,
    fetch: config.fetch,
  })
}
