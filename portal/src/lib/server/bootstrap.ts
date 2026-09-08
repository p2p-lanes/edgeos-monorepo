import "server-only"
import { QueryClient } from "@tanstack/react-query"
import { headers } from "next/headers"
import { cache } from "react"
import type { SessionSnapshot } from "../session-contract"
import { backendFetch, PortalHttpError } from "./backend"
import { ingressHeaders } from "./ingress"
import { sessionToken, validateSession } from "./session"
import {
  resolveRequestTenant,
  type ServerTenant,
  trustedOrigin,
} from "./tenant"

/** A class intentionally cannot be serialized into Client Component props.
 * Only snapshot/query data may cross that boundary; the bearer stays private.
 */
export class PortalServerContext {
  #token: string | undefined
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  })
  constructor(
    readonly tenant: ServerTenant,
    readonly snapshot: SessionSnapshot,
    token: string | undefined,
    private requestHeaders: Headers,
  ) {
    this.#token = token
  }
  async api<T>(path: string, language?: string | null): Promise<T> {
    if (this.snapshot.status === "unavailable")
      throw new PortalHttpError(503, "session_unavailable")
    const response = await backendFetch(path, {
      headers: {
        "X-Tenant-Id": this.tenant.id,
        ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
        ...(language ? { "Accept-Language": language } : {}),
        ...ingressHeaders(this.requestHeaders),
      },
    })
    if (!response.ok)
      throw new PortalHttpError(response.status, "resource_unavailable")
    return response.json()
  }
}

export async function createServerContext(
  request: Request,
  tenant: ServerTenant,
): Promise<PortalServerContext> {
  const token = sessionToken(request)
  if (!token)
    return new PortalServerContext(
      tenant,
      { status: "unknown", session: null },
      undefined,
      request.headers,
    )
  try {
    const session = await validateSession(token, tenant)
    return new PortalServerContext(
      tenant,
      { status: "authenticated", session },
      token,
      request.headers,
    )
  } catch (error) {
    const invalid =
      error instanceof PortalHttpError && error.code === "session_invalid"
    return new PortalServerContext(
      tenant,
      { status: invalid ? "unknown" : "unavailable", session: null },
      undefined,
      request.headers,
    )
  }
}

export const getServerTenant = cache(async () =>
  resolveRequestTenant(new Headers(await headers())),
)
export const getServerContext = cache(async () => {
  const requestHeaders = new Headers(await headers())
  return createServerContext(
    new Request(trustedOrigin(requestHeaders), { headers: requestHeaders }),
    await getServerTenant(),
  )
})
