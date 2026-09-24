import { createFetchTransport } from "./transport/fetchTransport"
import type { CheckoutClientConfig, Transport } from "./transport/types"
import type {
  CheckoutFormResponse,
  CheckoutPreviewRequest,
  CheckoutPreviewResponse,
  CheckoutProductsResponse,
  CouponValidatePublicResponse,
  OpenCartPublic,
  OpenCartUpsert,
  OpenTicketingPurchaseCreate,
  OpenTicketingPurchaseResponse,
  PrimaryCheckoutFlow,
} from "./types/api"

/**
 * Typed wrappers over the anonymous EdgeOS checkout endpoints. Each method is a
 * thin call over the injected {@link Transport} — no orchestration, no caching.
 * Higher layers (pricing driver, store) compose these.
 *
 * Sales flows are EdgeOS's own concept and no concern of a client building its
 * own checkout, so this client never takes a flow slug: it resolves the
 * popup's primary flow once and spends it on every call that needs one.
 */
export interface CheckoutClient {
  /** GET /checkout/{slug}/products — the popup's whole active catalogue. */
  getProducts(): Promise<CheckoutProductsResponse>
  /** GET /checkout/{slug}/form — the buyer form to render and validate. */
  getForm(): Promise<CheckoutFormResponse>
  /** GET /checkout/{slug}/primary — the flow slug the other calls run through. */
  getPrimaryFlow(): Promise<string>
  /** POST /checkout/{slug}/{primary}/preview — authoritative price breakdown. */
  preview(body: CheckoutPreviewRequest): Promise<CheckoutPreviewResponse>
  /** POST /coupons/validate-public — validate a code against this popup. */
  validateCoupon(code: string): Promise<CouponValidatePublicResponse>
  /** POST /checkout/{slug}/{primary}/purchase — create the payment, get the pay URL. */
  purchase(
    body: OpenTicketingPurchaseCreate,
  ): Promise<OpenTicketingPurchaseResponse>
  /** PUT /checkout/{slug}/{primary}/cart — persist the anonymous cart by email. */
  upsertCart(body: OpenCartUpsert): Promise<OpenCartPublic>
  /** GET /checkout/{slug}/{primary}/cart?cid&sig — restore a cart from a signed link. */
  restoreCart(cid: string, sig: string): Promise<OpenCartPublic>
}

/** Popup slug plus transport configuration. */
export type CheckoutClientOptions = CheckoutClientConfig

/**
 * Build a {@link CheckoutClient} for one popup slug.
 *
 * Pass a `transport` to inject the HTTP boundary (tests, SSR, custom auth). When
 * omitted, a default fetch transport is built from `config`.
 */
export function createCheckoutClient(
  config: CheckoutClientOptions,
  transport?: Transport,
): CheckoutClient {
  const t = transport ?? buildDefaultTransport(config)
  const slug = encodeURIComponent(config.slug)
  const popupBase = `/checkout/${slug}`

  // One in-flight resolution shared by every caller, dropped when it fails so
  // a transient error does not poison the client for its whole lifetime.
  let primaryFlow: Promise<string> | null = null

  function resolvePrimaryFlow(): Promise<string> {
    if (primaryFlow === null) {
      primaryFlow = t
        .request<PrimaryCheckoutFlow>("GET", `${popupBase}/primary`)
        .then((res) => res.flow_slug)
        .catch((error) => {
          primaryFlow = null
          throw error
        })
    }
    return primaryFlow
  }

  async function flowBase(): Promise<string> {
    return `${popupBase}/${encodeURIComponent(await resolvePrimaryFlow())}`
  }

  return {
    getProducts() {
      return t.request<CheckoutProductsResponse>("GET", `${popupBase}/products`)
    },
    getForm() {
      return t.request<CheckoutFormResponse>("GET", `${popupBase}/form`)
    },
    getPrimaryFlow() {
      return resolvePrimaryFlow()
    },
    async preview(body) {
      return t.request<CheckoutPreviewResponse>(
        "POST",
        `${await flowBase()}/preview`,
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
    async purchase(body) {
      return t.request<OpenTicketingPurchaseResponse>(
        "POST",
        `${await flowBase()}/purchase`,
        body,
      )
    },
    async upsertCart(body) {
      return t.request<OpenCartPublic>("PUT", `${await flowBase()}/cart`, body)
    },
    async restoreCart(cid, sig) {
      const query = `cid=${encodeURIComponent(cid)}&sig=${encodeURIComponent(sig)}`
      return t.request<OpenCartPublic>(
        "GET",
        `${await flowBase()}/cart?${query}`,
      )
    },
  }
}

function buildDefaultTransport(config: CheckoutClientOptions): Transport {
  // baseUrl is optional — createFetchTransport falls back to the EdgeOS
  // production API (DEFAULT_BASE_URL) when it isn't provided.
  return createFetchTransport({
    baseUrl: config.baseUrl,
    slug: config.slug,
    publishableKey: config.publishableKey,
    fetch: config.fetch,
  })
}
