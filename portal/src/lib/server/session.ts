import "server-only"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { backendFetch, PortalHttpError } from "./backend"
import { isLoopbackHost, requestHost, type ServerTenant } from "./tenant"

const sessionSchema = z.object({
  human: z.object({
    id: z.uuid(),
    tenant_id: z.uuid(),
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    picture_url: z.string().nullable(),
  }),
  expires_at: z.iso.datetime({ offset: true }),
})
export type PortalSession = z.infer<typeof sessionSchema>

function cookieOptions(headers: Headers) {
  const secure = !isLoopbackHost(requestHost(headers).hostname)
  return {
    name: secure ? "__Host-edge_session" : "edge_session_dev",
    secure,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
  }
}

export function sessionToken(request: Request): string | undefined {
  const { name } = cookieOptions(request.headers)
  return new NextRequest(request.url, { headers: request.headers }).cookies.get(
    name,
  )?.value
}

export async function validateSession(
  token: string,
  tenant: ServerTenant,
): Promise<PortalSession> {
  // Tokens stay opaque here. Only the backend may establish provenance and expiry.
  if (!token || token.length > 3800 || !/^[A-Za-z0-9_.-]+$/.test(token)) {
    throw new PortalHttpError(401, "session_invalid")
  }
  const response = await backendFetch("/api/v1/auth/human/session", {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": tenant.id },
  })
  if ([401, 403, 404].includes(response.status))
    throw new PortalHttpError(401, "session_invalid")
  if (!response.ok) {
    throw new PortalHttpError(
      response.status >= 500 || response.status === 429 ? response.status : 502,
      "session_unavailable",
      response.headers.get("retry-after"),
    )
  }
  const parsed = sessionSchema.safeParse(await response.json())
  if (!parsed.success)
    throw new PortalHttpError(502, "invalid_session_response")
  if (
    parsed.data.human.tenant_id !== tenant.id ||
    Date.parse(parsed.data.expires_at) <= Date.now()
  ) {
    throw new PortalHttpError(401, "session_invalid")
  }
  return parsed.data
}

export async function readSession(
  request: Request,
  tenant: ServerTenant,
): Promise<PortalSession | null> {
  const token = sessionToken(request)
  return token ? validateSession(token, tenant) : null
}

export function setSessionCookie(
  response: Response,
  request: Request,
  token: string,
  session: PortalSession,
): Response {
  const result = new NextResponse(response.body, response)
  result.cookies.set({
    ...cookieOptions(request.headers),
    value: token,
    expires: new Date(session.expires_at),
  })
  return result
}

export function deleteSessionCookie(
  response: Response,
  request: Request,
): Response {
  const result = new NextResponse(response.body, response)
  result.cookies.set({
    ...cookieOptions(request.headers),
    value: "",
    expires: new Date(0),
    maxAge: 0,
  })
  return result
}
