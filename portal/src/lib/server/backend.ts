import "server-only"

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie, Host",
  "X-Content-Type-Options": "nosniff",
}

export class PortalHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter?: string | null,
  ) {
    super(code)
  }
}

export function backendOrigin(): string {
  // Unlike NEXT_PUBLIC_API_URL, this variable is not inlined by Next at build time.
  const value =
    process.env.PORTAL_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL
  try {
    const url = new URL(value || "http://localhost:8000")
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error()
    return url.origin
  } catch {
    throw new PortalHttpError(503, "server_configuration_unavailable")
  }
}

export async function backendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (
    !path.startsWith("/api/v1/") ||
    path.includes("\\") ||
    path.includes("#")
  ) {
    throw new PortalHttpError(400, "invalid_path")
  }
  const url = new URL(path, backendOrigin())
  if (url.origin !== backendOrigin() || !url.pathname.startsWith("/api/v1/")) {
    throw new PortalHttpError(400, "invalid_path")
  }
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new PortalHttpError(503, "upstream_unavailable")
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel()
    throw new PortalHttpError(502, "upstream_redirect_rejected")
  }
  return response
}

export function privateJson(
  body: unknown,
  status = 200,
  extra?: HeadersInit,
): Response {
  const headers = new Headers(PRIVATE_HEADERS)
  new Headers(extra).forEach((value, key) => {
    headers.set(key, value)
  })
  return Response.json(body, { status, headers })
}

export function errorResponse(error: unknown): Response {
  const known =
    error instanceof PortalHttpError
      ? error
      : new PortalHttpError(503, "upstream_unavailable")
  return privateJson(
    {
      code: known.code,
      retryable: known.status === 429 || known.status >= 500,
    },
    known.status,
    known.retryAfter ? { "Retry-After": known.retryAfter } : undefined,
  )
}

export async function readBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) {
    throw new PortalHttpError(413, "request_too_large")
  }
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new PortalHttpError(413, "request_too_large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
