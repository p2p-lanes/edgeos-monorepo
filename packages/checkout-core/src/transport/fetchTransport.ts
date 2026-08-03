import { CheckoutApiError } from "./errors"
import type { CheckoutClientConfig, Transport } from "./types"

const PUBLISHABLE_KEY_HEADER = "X-EdgeOS-Publishable-Key"

/**
 * EdgeOS production API root. Used when no `baseUrl` is supplied, so a client
 * only needs their slug + publishable key. Override `baseUrl` for dev/staging
 * (e.g. a local `http://localhost:8000/api/v1`) or a self-hosted proxy.
 */
export const DEFAULT_BASE_URL = "https://api.edgeos.world/api/v1"

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

/** Default fetch-based Transport. Injects the publishable key header when set. */
export function createFetchTransport(config: CheckoutClientConfig): Transport {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const fetchImpl = config.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "No fetch implementation available; pass config.fetch for this environment.",
    )
  }

  return {
    async request<T>(
      method: string,
      path: string,
      body?: unknown,
      opts?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<T> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(opts?.headers ?? {}),
      }
      if (config.publishableKey) {
        headers[PUBLISHABLE_KEY_HEADER] = config.publishableKey
      }

      const res = await fetchImpl(joinUrl(baseUrl, path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: opts?.signal,
      })

      if (!res.ok) {
        let detail: unknown
        try {
          detail = await res.json()
        } catch {
          detail = undefined
        }
        throw new CheckoutApiError(res.status, detail)
      }

      if (res.status === 204) {
        return undefined as T
      }
      return (await res.json()) as T
    },
  }
}
