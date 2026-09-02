export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"

export interface RequestOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * Minimal HTTP boundary the core depends on. A host app may supply its own
 * (auth, retries, SSR fetch) instead of the default fetch transport.
 */
export interface Transport {
  request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T>
}

export interface CheckoutClientConfig {
  /**
   * API root including version prefix, e.g. "https://api.example.com/api/v1".
   * Optional — defaults to the EdgeOS production API ({@link DEFAULT_BASE_URL}).
   * Override only for a non-prod environment or a self-hosted proxy.
   */
  baseUrl?: string
  /** Popup slug — the checkout these calls target. */
  slug: string
  /** Canonical sales-flow slug, such as `checkout` or `attendee`. */
  flowSlug: string
  /** Browser-safe per-popup publishable key (pk_live_…), sent as a header. */
  publishableKey?: string
  /** Injectable fetch for SSR / tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch
}
